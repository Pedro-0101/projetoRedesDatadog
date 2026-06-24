// Closed-loop: o Datadog dirige a reacao da rede SDN.
//
// O Datadog Cloud nao alcanca a API em localhost, entao em vez de receber um
// webhook nos *consultamos* o estado dos monitors via Datadog API (poll). Quando
// o monitor `[Demo SDN] Worker degradado` (agrupado por worker, tag demo:sdn)
// entra em Alert para um worker, bloqueamos esse worker — uma acao de controle
// que a heuristica interna NAO faz sozinha (selectWorker apenas evita por score).
// Quando o monitor volta a OK, reativamos o worker (somente se fomos nos que o
// bloqueamos, para nao brigar com bloqueios manuais).
//
// Espelha o padrao de poller de sdnController.startHealthPolling (setInterval +
// unref) e reutiliza blockWorker/unblockWorker/emitDatadogEvent.
import axios from 'axios';
import { blockWorker, unblockWorker, emitDatadogEvent } from './sdnController';

const POLL_INTERVAL_MS = 15000;
const DD_SITE = process.env.DD_SITE || 'us5.datadoghq.com';
const DD_API_KEY = process.env.DD_API_KEY || '';
const DD_APP_KEY = process.env.DD_APP_KEY || '';

export interface MonitorGroupState {
  name: string; // ex.: "worker:worker-a" (monitor agrupado por {worker})
  status: string; // Datadog: 'OK' | 'Alert' | 'Warn' | 'No Data' | ...
}

export interface RemediationAction {
  timestamp: string;
  action: 'block' | 'unblock';
  worker: string;
}

let enabled = process.env.SDN_AUTOREMEDIATION === 'true';
let pollTimer: ReturnType<typeof setInterval> | null = null;
const autoBlocked = new Set<string>();
const lastActions: RemediationAction[] = [];

function logJSON(level: string, message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
      autoremediation: true,
    }) + '\n'
  );
}

// Extrai o nome do worker do nome de grupo do monitor ("worker:worker-a" -> "worker-a").
// Retorna null para grupos sem dimensao worker (ex.: "*"), que sao ignorados.
export function parseWorkerFromGroup(groupName: string): string | null {
  const m = groupName.match(/(?:^|,)\s*worker:([^,]+)/);
  return m ? m[1].trim() : null;
}

function isAlert(status: string): boolean {
  return status === 'Alert';
}

// Logica de transicao PURA (testavel sem rede): dado o estado dos grupos dos
// monitors e o conjunto de workers que bloqueamos automaticamente, decide quais
// bloquear (entrou em Alert e ainda nao bloqueado) e quais reativar (estava
// auto-bloqueado e nao esta mais em Alert).
export function planActions(
  groups: MonitorGroupState[],
  currentlyAutoBlocked: Set<string>
): { toBlock: string[]; toUnblock: string[] } {
  const alerting = new Set<string>();
  const toBlock: string[] = [];

  for (const g of groups) {
    const worker = parseWorkerFromGroup(g.name);
    if (!worker) continue;
    if (isAlert(g.status)) {
      alerting.add(worker);
      if (!currentlyAutoBlocked.has(worker) && !toBlock.includes(worker)) {
        toBlock.push(worker);
      }
    }
  }

  const toUnblock: string[] = [];
  for (const worker of currentlyAutoBlocked) {
    if (!alerting.has(worker)) toUnblock.push(worker);
  }

  return { toBlock, toUnblock };
}

function collectGroups(monitors: unknown[]): MonitorGroupState[] {
  const out: MonitorGroupState[] = [];
  for (const m of monitors ?? []) {
    const groups = (m as { state?: { groups?: Record<string, { status?: string }> } })?.state?.groups;
    if (groups && typeof groups === 'object') {
      for (const [name, g] of Object.entries(groups)) {
        out.push({ name, status: String(g?.status ?? '') });
      }
    }
  }
  return out;
}

function recordAction(action: 'block' | 'unblock', worker: string): void {
  lastActions.unshift({ timestamp: new Date().toISOString(), action, worker });
  if (lastActions.length > 20) lastActions.pop();
}

async function fetchMonitorGroups(): Promise<MonitorGroupState[]> {
  const resp = await axios.get(`https://api.${DD_SITE}/api/v1/monitor`, {
    params: { monitor_tags: 'demo:sdn', group_states: 'all' },
    headers: { 'DD-API-KEY': DD_API_KEY, 'DD-APPLICATION-KEY': DD_APP_KEY },
    timeout: 5000,
  });
  return collectGroups(Array.isArray(resp.data) ? resp.data : []);
}

// Um ciclo: consulta os monitors, planeja e aplica as acoes. Exportada para teste.
export async function tick(): Promise<void> {
  if (!enabled) return;
  if (!DD_API_KEY || !DD_APP_KEY) {
    logJSON('warn', 'Auto-remediacao habilitada mas DD_API_KEY/DD_APP_KEY ausentes; desativando');
    enabled = false;
    return;
  }

  let groups: MonitorGroupState[];
  try {
    groups = await fetchMonitorGroups();
  } catch (err) {
    logJSON('warn', 'Falha ao consultar monitors do Datadog', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return;
  }

  const { toBlock, toUnblock } = planActions(groups, autoBlocked);

  for (const worker of toBlock) {
    if (blockWorker(worker)) {
      autoBlocked.add(worker);
      recordAction('block', worker);
      logJSON('warn', 'Auto-remediacao: worker bloqueado por monitor em Alert', {
        worker, sdn_route_change: true, driven_by: 'datadog_monitor',
      });
      emitDatadogEvent(
        `Auto-remediacao: ${worker} bloqueado pelo Datadog`,
        `Monitor demo:sdn em Alert para ${worker}; o controlador SDN bloqueou a rota automaticamente.`,
        [`worker:${worker}`, 'event:auto_remediation'],
        'error'
      );
    }
  }

  for (const worker of toUnblock) {
    if (unblockWorker(worker)) {
      autoBlocked.delete(worker);
      recordAction('unblock', worker);
      logJSON('info', 'Auto-remediacao: worker reativado (monitor recuperado)', {
        worker, sdn_route_change: true, driven_by: 'datadog_monitor',
      });
      emitDatadogEvent(
        `Auto-remediacao: ${worker} reativado pelo Datadog`,
        `Monitor demo:sdn voltou a OK para ${worker}; o controlador SDN reativou a rota.`,
        [`worker:${worker}`, 'event:auto_remediation'],
        'success'
      );
    }
  }
}

export function startAutoRemediation(intervalMs = POLL_INTERVAL_MS): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void tick(), intervalMs);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  logJSON('info', 'Poller de auto-remediacao iniciado', { enabled, intervalMs });
}

export function stopAutoRemediation(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function enable(): void {
  enabled = true;
  logJSON('info', 'Auto-remediacao habilitada');
}

export function disable(): void {
  enabled = false;
  logJSON('info', 'Auto-remediacao desabilitada');
}

export function isEnabled(): boolean {
  return enabled;
}

export function getStatus(): { enabled: boolean; autoBlocked: string[]; lastActions: RemediationAction[] } {
  return { enabled, autoBlocked: Array.from(autoBlocked), lastActions: [...lastActions] };
}
