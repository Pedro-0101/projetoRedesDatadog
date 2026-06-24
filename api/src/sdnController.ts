import StatsD from 'hot-shots';
import axios from 'axios';
import tracer from './tracer';
import * as qos from './qosController';
import * as flowRules from './flowRules';
import * as shaping from './tokenBucket';
import { baseTags } from './ddTags';

const WINDOW_SIZE = 20;
const HEALTHY_THRESHOLD_LATENCY = 500;
const DEGRADED_THRESHOLD_LATENCY = 2000;
const DEGRADED_THRESHOLD_ERROR = 0.25;
const STALE_TIMEOUT_MS = 30000;
// Apos este tempo sem trafego real (/processar), as amostras de latencia/erro
// na janela sao consideradas obsoletas: um worker vivo (responde ao heartbeat)
// que ficou ocioso depois de um teste de anomalia volta a 'healthy' em vez de
// permanecer degradado/critico com base em medicoes antigas.
const STATS_FRESHNESS_MS = 15000;

interface WorkerStats {
  url: string;
  name: string;
  avgLatency: number;
  errorRate: number;
  inFlight: number;
  blocked: boolean;
  recentLatencies: number[];
  recentErrors: boolean[];
  lastSeen: number;
  lastResultAt: number;
}

interface RoutingDecision {
  worker: string;
  reason: 'least_latency' | 'failover' | 'round_robin' | 'forced';
  alternatives: string[];
}

interface SdnEvent {
  type: 'route_change' | 'worker_blocked' | 'worker_unblocked' | 'health_change';
  worker: string;
  timestamp: string;
  details: Record<string, unknown>;
}

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

const WORKER_URLS = (process.env.SDN_WORKERS ?? 'http://worker-a:8080,http://worker-b:8080,http://worker-c:8080')
  .split(',')
  .map((u) => u.trim());

function buildWorkerName(url: string): string {
  const match = url.match(/http:\/\/([^:]+)/);
  return match ? match[1] : url;
}

const workers: Map<string, WorkerStats> = new Map(
  WORKER_URLS.map((url) => [
    buildWorkerName(url),
    {
      url,
      name: buildWorkerName(url),
      avgLatency: 0,
      errorRate: 0,
      inFlight: 0,
      blocked: false,
      recentLatencies: [],
      recentErrors: [],
      lastSeen: Date.now(),
      lastResultAt: Date.now(),
    },
  ])
);

const sseClients = new Set<(event: SdnEvent) => void>();
let roundRobinIndex = 0;

// Modo de roteamento:
//  - 'health-score' (padrao): selectWorker escolhe o worker com maior score
//    (1 - errorRate - latency/5000). A heuristica JA evita um worker ruim sozinha.
//  - 'round-robin': distribui igualmente entre os workers nao bloqueados,
//    IGNORANDO a saude. Mantem o trafego batendo no worker degradado ate que o
//    Datadog perceba a anomalia e o bloqueie (closed-loop) — assim quem reroteia
//    e o Datadog, nao a heuristica local. Workers bloqueados sempre saem da rota.
export type RoutingMode = 'health-score' | 'round-robin';
let routingMode: RoutingMode = (process.env.SDN_ROUTING_MODE as RoutingMode) || 'health-score';

export function getRoutingMode(): RoutingMode {
  return routingMode;
}

export function setRoutingMode(mode: RoutingMode): RoutingMode {
  if (mode === 'round-robin' || mode === 'health-score') {
    routingMode = mode;
    logJSON('info', 'Modo de roteamento alterado', { routing_mode: mode });
  }
  return routingMode;
}

function broadcastSdnEvent(event: SdnEvent): void {
  for (const cb of sseClients) {
    try { cb(event); } catch { /* ignore */ }
  }
}

// Publica um Datadog Event via DogStatsD (statsd.event → agent 8125). Diferente
// de um log, o evento aparece como marca vertical (overlay) nos timeseries do
// dashboard via query `tags:sdn`, correlacionando visualmente cada decisao de
// controle com a metrica que muda. Sem necessidade de DD_API_KEY na API.
export function emitDatadogEvent(
  title: string,
  text: string,
  extraTags: string[] = [],
  alertType: 'info' | 'warning' | 'error' | 'success' = 'info'
): void {
  statsd.event(
    title,
    text,
    { alert_type: alertType, source_type_name: 'my apps' },
    baseTags('sdn', ...extraTags)
  );
}

// Throttle de eventos de reroute: como reroutes ocorrem por request com falha,
// emitir um Datadog Event a cada um inundaria o overlay. Limita a 1 evento por
// worker a cada REROUTE_EVENT_COOLDOWN_MS.
const REROUTE_EVENT_COOLDOWN_MS = 30000;
const lastRerouteEventAt = new Map<string, number>();

function shouldEmitRerouteEvent(worker: string): boolean {
  const now = Date.now();
  const last = lastRerouteEventAt.get(worker) ?? 0;
  if (now - last < REROUTE_EVENT_COOLDOWN_MS) return false;
  lastRerouteEventAt.set(worker, now);
  return true;
}

function logJSON(level: string, message: string, extra: Record<string, unknown> = {}): void {
  const span = tracer.scope().active();
  const ctx = span ? span.context() : null;
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(ctx ? { 'dd.trace_id': ctx.toTraceId(), 'dd.span_id': ctx.toSpanId() } : {}),
      ...extra,
      sdn: true,
    }) + '\n'
  );
}

export function getWorkerStats(): WorkerStats[] {
  return Array.from(workers.values());
}

export function getWorker(name: string): WorkerStats | undefined {
  return workers.get(name);
}

export function blockWorker(name: string): boolean {
  const w = workers.get(name);
  if (!w) return false;
  w.blocked = true;
  statsd.gauge('sdn.route.blocked', 1, baseTags(`worker:${name}`));
  logJSON('warn', 'Worker bloqueado manualmente', { worker: name, sdn_route_change: true });
  broadcastSdnEvent({
    type: 'worker_blocked',
    worker: name,
    timestamp: new Date().toISOString(),
    details: {},
  });
  emitDatadogEvent(
    `SDN: worker ${name} bloqueado`,
    `O controlador SDN bloqueou ${name}; o trafego sera roteado para os demais workers.`,
    [`worker:${name}`, 'event:worker_blocked'],
    'warning'
  );
  return true;
}

export function unblockWorker(name: string): boolean {
  const w = workers.get(name);
  if (!w) return false;
  w.blocked = false;
  statsd.gauge('sdn.route.blocked', 0, baseTags(`worker:${name}`));
  logJSON('info', 'Worker reativado', { worker: name, sdn_route_change: true });
  broadcastSdnEvent({
    type: 'worker_unblocked',
    worker: name,
    timestamp: new Date().toISOString(),
    details: {},
  });
  emitDatadogEvent(
    `SDN: worker ${name} reativado`,
    `O controlador SDN reativou ${name}; ele volta a receber trafego.`,
    [`worker:${name}`, 'event:worker_unblocked'],
    'success'
  );
  return true;
}

// Injeta uma taxa de erro intrinseca em UM worker (proxy para o /fault da
// instancia Go). errorRate=0 remove a falha. Decoplado do trafego de teste: o
// worker passa a falhar por conta propria, fazendo sdn.worker.error_rate{worker}
// subir e o monitor demo:sdn entrar em Alert so para ele.
export async function injectFault(name: string, errorRate: number): Promise<boolean> {
  const w = workers.get(name);
  if (!w) return false;
  await axios.post(`${w.url}/fault`, null, {
    params: { errorRate },
    timeout: 5000,
    validateStatus: () => true,
  });
  logJSON('warn', 'Fault injection aplicada em worker', { worker: name, fault_error_rate: errorRate });
  emitDatadogEvent(
    errorRate > 0 ? `SDN: falha injetada em ${name}` : `SDN: falha removida de ${name}`,
    errorRate > 0
      ? `Taxa de erro intrinseca de ${name} ajustada para ${(errorRate * 100).toFixed(0)}% (simulacao de worker degradado).`
      : `Falha intrinseca de ${name} removida; o worker volta a operar normalmente.`,
    [`worker:${name}`, 'event:fault_injection'],
    errorRate > 0 ? 'warning' : 'success'
  );
  return true;
}

function calculateHealth(ws: WorkerStats): 'healthy' | 'degraded' | 'critical' | 'blocked' | 'unknown' {
  if (ws.blocked) return 'blocked';
  const elapsed = Date.now() - ws.lastSeen;
  if (elapsed > STALE_TIMEOUT_MS) return 'unknown';
  if (ws.errorRate < 0.05 && ws.avgLatency < HEALTHY_THRESHOLD_LATENCY) return 'healthy';
  if (ws.errorRate < DEGRADED_THRESHOLD_ERROR && ws.avgLatency < DEGRADED_THRESHOLD_LATENCY) return 'degraded';
  return 'critical';
}

function selectWorker(excludeNames: string[] = []): RoutingDecision {
  const healthy = Array.from(workers.values()).filter(
    (w) => !w.blocked && !excludeNames.includes(w.name)
  );

  // Modo round-robin: distribui igualmente entre os nao bloqueados, sem olhar
  // saude. O worker degradado continua recebendo trafego (e falhando) ate o
  // Datadog bloquea-lo via closed-loop.
  if (routingMode === 'round-robin') {
    const pool = healthy.length > 0
      ? healthy
      : Array.from(workers.values()).filter((w) => !w.blocked);
    const candidates = pool.length > 0 ? pool : Array.from(workers.values());
    const idx = roundRobinIndex++ % candidates.length;
    const w = candidates[idx];
    return {
      worker: w.name,
      reason: 'round_robin',
      alternatives: candidates.filter((c) => c.name !== w.name).map((c) => c.name),
    };
  }

  if (healthy.length === 0) {
    const fallback = Array.from(workers.values()).filter((w) => !w.blocked);
    if (fallback.length === 0) {
      const any_alive = Array.from(workers.values());
      const idx = roundRobinIndex++ % any_alive.length;
      const w = any_alive[idx];
      return { worker: w.name, reason: 'round_robin', alternatives: [] };
    }
    const idx = roundRobinIndex++ % fallback.length;
    const w = fallback[idx];
    return { worker: w.name, reason: 'round_robin', alternatives: fallback.map((f) => f.name) };
  }

  const scored = healthy
    .map((w) => ({
      worker: w,
      score: 1 - w.errorRate - w.avgLatency / 5000,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alternatives = scored.slice(1).map((s) => s.worker.name);

  return {
    worker: best.worker.name,
    reason: best.score > 0.5 ? 'least_latency' : 'failover',
    alternatives,
  };
}

function incrementCounter(metric: string, tags: string[], value = 1): void {
  statsd.increment(metric, value, tags);
}

export function getWorkerBriefs(): flowRules.WorkerStatsBrief[] {
  return Array.from(workers.values()).map((w) => ({
    name: w.name,
    avgLatency: w.avgLatency,
    errorRate: w.errorRate,
    inFlight: w.inFlight,
    blocked: w.blocked,
  }));
}

export async function route(
  payload: Record<string, unknown>,
  priority?: string
): Promise<{ worker: string; response: { status: number; data: unknown }; latency: number }> {
  let qosPriority: qos.Priority = resolvePriority(priority);

  const flowCtx: flowRules.FlowContext = { priority: qosPriority, ...payload };
  const wsBrief = getWorkerBriefs();
  const flowResult = flowRules.evaluate(flowCtx, wsBrief);

  if (flowResult && flowResult.action.type === 'drop') {
    return {
      worker: 'flow-rule',
      response: { status: 503, data: { error: 'Flow rule drop', rule: flowResult.rule.id } },
      latency: 0,
    };
  }

  let extraDelayMs = 0;
  let forcedWorker: string | null = null;

  if (flowResult) {
    if (flowResult.action.type === 'redirect') {
      forcedWorker = flowResult.action.toWorker;
    } else if (flowResult.action.type === 'add_delay') {
      extraDelayMs = flowResult.action.ms;
    } else if (flowResult.action.type === 'set_priority') {
      qosPriority = flowResult.action.to;
    }
  }

  await qos.acquire(qosPriority);

  let decision: RoutingDecision;
  if (forcedWorker) {
    decision = { worker: forcedWorker, reason: 'forced', alternatives: [] };
  } else {
    decision = selectWorker();
  }

  const selectedWorker = workers.get(decision.worker);
  if (!selectedWorker) {
    qos.release(qosPriority);
    throw new Error('Nenhum worker disponivel');
  }

  selectedWorker.inFlight++;

  incrementCounter('sdn.route.selected', baseTags(`worker:${decision.worker}`, `reason:${decision.reason}`));

  if (extraDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, extraDelayMs));
  }

  const shapingWait = shaping.check(decision.worker);
  if (shapingWait === -1) {
    qos.release(qosPriority);
    selectedWorker.inFlight--;
    return {
      worker: decision.worker,
      response: { status: 429, data: { error: 'Token bucket empty', retryAfter: 1 } },
      latency: 0,
    };
  }
  if (shapingWait > 0) {
    await new Promise((resolve) => setTimeout(resolve, shapingWait));
  }

  const t0 = Date.now();
  let responseStatus: number;
  let responseData: unknown;

  try {
    const resp = await axios.post(
      `${selectedWorker.url}/processar`,
      payload,
      {
        headers: {
          'X-Error-Rate': String(payload.errorRate ?? 0.1),
          'X-Min-Delay': String(payload.minDelay ?? 100),
          'X-Max-Delay': String(payload.maxDelay ?? 500),
        },
        validateStatus: () => true,
        timeout: 10000,
      }
    );
    responseStatus = resp.status;
    responseData = resp.data;
  } catch (err) {
    responseStatus = 500;
    responseData = { error: err instanceof Error ? err.message : 'unknown' };
  }

  const latency = Date.now() - t0;
  const success = responseStatus >= 200 && responseStatus < 300;

  recordResult(decision.worker, latency, success);

  qos.release(qosPriority);

  if (!success) {
    incrementCounter('sdn.route.rerouted', baseTags(`from_worker:${decision.worker}`, `to_worker:${decision.alternatives[0] ?? 'none'}`));
    logJSON('warn', 'Rerouting triggered', {
      from_worker: decision.worker,
      alternatives: decision.alternatives,
      status: responseStatus,
      sdn_route_change: true,
    });
    broadcastSdnEvent({
      type: 'route_change',
      worker: decision.worker,
      timestamp: new Date().toISOString(),
      details: { status: responseStatus, alternatives: decision.alternatives },
    });
    if (shouldEmitRerouteEvent(decision.worker)) {
      emitDatadogEvent(
        `SDN: reroute a partir de ${decision.worker}`,
        `Falha (status ${responseStatus}) em ${decision.worker}; alternativas: ${decision.alternatives.join(', ') || 'nenhuma'}.`,
        [`worker:${decision.worker}`, 'event:route_change'],
        'warning'
      );
    }
  }

  statsd.histogram('sdn.worker.latency', latency, baseTags(`worker:${decision.worker}`, `health:${calculateHealth(selectedWorker)}`));

  return { worker: decision.worker, response: { status: responseStatus, data: responseData }, latency };
}

function resolvePriority(p: string | undefined): qos.Priority {
  if (p === 'gold' || p === 'silver' || p === 'bronze') return p;
  return 'silver';
}

export function getSdnEvents(cb: (event: SdnEvent) => void): () => void {
  sseClients.add(cb);
  return () => sseClients.delete(cb);
}

export function healthCheck(): Record<string, unknown>[] {
  return Array.from(workers.values()).map((w) => ({
    name: w.name,
    url: w.url,
    health: calculateHealth(w),
    avgLatency: Math.round(w.avgLatency),
    errorRate: parseFloat(w.errorRate.toFixed(4)),
    inFlight: w.inFlight,
    blocked: w.blocked,
  }));
}

// ---- Node state overrides ---------------------------------------------------
// Permite que a UI desabilite nos ou sobrescreva propriedades (ex.: health).
// Os overrides persistem ate que sejam resetados explicitamente.
interface NodeOverride {
  disabled?: boolean;
  health?: TopologyNode['health'];
}

const nodeOverrides = new Map<string, NodeOverride>();

export function setNodeOverride(id: string, updates: NodeOverride): boolean {
  const existing = nodeOverrides.get(id) || {};
  nodeOverrides.set(id, { ...existing, ...updates });
  return true;
}

export function resetNodeOverride(id: string): boolean {
  return nodeOverrides.delete(id);
}

export function getAllNodeOverrides(): Record<string, NodeOverride> {
  const result: Record<string, NodeOverride> = {};
  for (const [id, ov] of nodeOverrides) result[id] = ov;
  return result;
}

// ---- Heartbeat ativo -------------------------------------------------------
// Sem este poller, lastSeen so avanca quando trafego e roteado para o worker
// (recordResult). Workers ociosos por > STALE_TIMEOUT_MS virariam 'unknown'
// mesmo estando vivos. O poller faz probe periodico de /health e mantem
// lastSeen atualizado para workers alcancaveis; se o probe falha, lastSeen nao
// avanca e o worker corretamente decai para 'unknown'.
const HEALTH_POLL_INTERVAL_MS = 10000;
let healthPollTimer: ReturnType<typeof setInterval> | null = null;

async function probeWorker(w: WorkerStats): Promise<void> {
  try {
    const resp = await axios.get(`${w.url}/health`, {
      timeout: 3000,
      validateStatus: () => true,
    });
    if (resp.status >= 200 && resp.status < 300) {
      w.lastSeen = Date.now();
      // Worker vivo, porem sem trafego real recente: descarta amostras obsoletas
      // para que nao continue marcado como degradado/critico por medicoes antigas.
      if (w.recentLatencies.length > 0 && Date.now() - w.lastResultAt > STATS_FRESHNESS_MS) {
        w.recentLatencies = [];
        w.recentErrors = [];
        w.avgLatency = 0;
        w.errorRate = 0;
      }
    }
  } catch {
    /* probe falhou: lastSeen nao avanca → decai para 'unknown' apos timeout */
  }
}

export function startHealthPolling(intervalMs = HEALTH_POLL_INTERVAL_MS): void {
  if (healthPollTimer) return;
  const tick = (): void => {
    for (const w of workers.values()) void probeWorker(w);
  };
  tick();
  healthPollTimer = setInterval(tick, intervalMs);
  if (typeof healthPollTimer.unref === 'function') healthPollTimer.unref();
}

export function stopHealthPolling(): void {
  if (healthPollTimer) {
    clearInterval(healthPollTimer);
    healthPollTimer = null;
  }
}

interface TopologyNode {
  id: string;
  label: string;
  type: 'client' | 'api' | 'worker' | 'db' | 'datadog';
  // Plano SDN: 'control' = decide rotas / observa e dirige (api, datadog);
  // 'data' = encaminha o trafego real das requisicoes (browser, workers, db).
  // Nesta demo ambos rodam no mesmo processo; o campo torna a separacao explicita na UI.
  plane: 'control' | 'data';
  health: 'healthy' | 'degraded' | 'critical' | 'blocked' | 'unknown';
  // Identidade de dispositivo. ip/mac sao sinteticos e deterministicos por id
  // (placeholders) — substitua por dados reais de inventario se disponiveis.
  deviceType: 'host' | 'controller' | 'worker' | 'database' | 'monitor';
  ip: string;
  mac: string;
  metrics: {
    rps: number;
    avgLatency: number;
    errorRate: number;
    inFlight: number;
    activeFlows: number;
  };
}

interface TopologyEdge {
  from: string;
  to: string;
  rps: number;
  blocked: boolean;
  // Plano do enlace: 'control' = sinalizacao/observacao (postgres -> datadog);
  // 'data' = encaminhamento das requisicoes (browser -> api -> worker -> db).
  plane: 'control' | 'data';
  activeRuleId?: string;
  // Metricas de link. bandwidthMbps e capacidade nominal; utilization/latency/
  // packetLoss sao derivados das estatisticas reais de worker quando aplicavel.
  bandwidthMbps: number;
  utilization: number; // 0..1
  latencyMs: number;
  packetLoss: number; // 0..1
  trafficKind: 'normal' | 'anomalous' | 'control';
}

interface TopologySnapshot {
  timestamp: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  activeRules: Array<{ id: string; name: string; matchCount: number }>;
}

const rpsBuckets: Map<string, number[]> = new Map();

function trackRps(workerName: string): void {
  const now = Date.now();
  if (!rpsBuckets.has(workerName)) {
    rpsBuckets.set(workerName, []);
  }
  const bucket = rpsBuckets.get(workerName)!;
  bucket.push(now);
  const cutoff = now - 10000;
  rpsBuckets.set(workerName, bucket.filter((t) => t > cutoff));
}

function getRps(workerName: string): number {
  const bucket = rpsBuckets.get(workerName);
  if (!bucket || bucket.length < 2) return 0;
  const cutoff = Date.now() - 10000;
  const recent = bucket.filter((t) => t > cutoff);
  return recent.length / 10;
}

export function recordResult(workerName: string, latencyMs: number, success: boolean): void {
  const w = workers.get(workerName);
  if (!w) return;

  w.recentLatencies.push(latencyMs);
  w.recentErrors.push(!success);
  w.inFlight = Math.max(0, w.inFlight - 1);
  w.lastSeen = Date.now();
  w.lastResultAt = Date.now();

  if (w.recentLatencies.length > WINDOW_SIZE) {
    w.recentLatencies.shift();
    w.recentErrors.shift();
  }

  w.avgLatency =
    w.recentLatencies.reduce((a, b) => a + b, 0) / w.recentLatencies.length;
  w.errorRate =
    w.recentErrors.reduce((a, b) => a + (b ? 1 : 0), 0) / w.recentErrors.length;

  const healthTag = `health:${calculateHealth(w)}`;
  statsd.histogram('sdn.worker.latency', latencyMs, baseTags(`worker:${workerName}`, healthTag));
  statsd.gauge('sdn.worker.error_rate', w.errorRate, baseTags(`worker:${workerName}`, healthTag));

  trackRps(workerName);
}

const DEVICE_TYPE_BY_NODE: Record<string, TopologyNode['deviceType']> = {
  browser: 'host',
  api: 'controller',
  postgres: 'database',
  datadog: 'monitor',
};

const LINK_BANDWIDTH_MBPS = 1000;
const LINK_RPS_CAPACITY = 40; // rps que satura o link (para derivar utilization)

// Sintetiza um octeto/segmento estavel a partir do id (placeholder substituivel).
function hashByte(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xff;
  return h;
}

// IP/MAC deterministicos por id. PLACEHOLDER: troque por dados reais de inventario.
function synthIp(id: string): string {
  const subnetByType: Record<string, number> = { browser: 0, api: 1, postgres: 2, datadog: 3 };
  const subnet = subnetByType[id] ?? 10; // workers caem em 10.0.10.x
  return `10.0.${subnet}.${(hashByte(id, 7) % 254) + 1}`;
}

function synthMac(id: string): string {
  const b = (s: number) => hashByte(id, s).toString(16).padStart(2, '0');
  return `02:42:${b(1)}:${b(2)}:${b(3)}:${b(4)}`;
}

function deviceTypeFor(id: string, type: TopologyNode['type']): TopologyNode['deviceType'] {
  if (DEVICE_TYPE_BY_NODE[id]) return DEVICE_TYPE_BY_NODE[id];
  return type === 'worker' ? 'worker' : 'host';
}

// Plano de cada no: a API (controlador SDN) e o Datadog (observa e dirige o
// closed-loop) formam o plano de controle; o restante encaminha trafego (dados).
const CONTROL_PLANE_NODES = new Set(['api', 'datadog']);
function planeFor(id: string): TopologyNode['plane'] {
  return CONTROL_PLANE_NODES.has(id) ? 'control' : 'data';
}

// Constroi uma aresta enriquecida derivando metricas de link das stats reais.
function buildEdge(
  from: string,
  to: string,
  rps: number,
  opts: { blocked?: boolean; latencyMs?: number; errorRate?: number; control?: boolean } = {}
): TopologyEdge {
  const blocked = opts.blocked ?? false;
  const errorRate = opts.errorRate ?? 0;
  const utilization = Math.min(1, rps / LINK_RPS_CAPACITY);
  const trafficKind: TopologyEdge['trafficKind'] = opts.control
    ? 'control'
    : blocked || errorRate >= DEGRADED_THRESHOLD_ERROR
    ? 'anomalous'
    : 'normal';
  return {
    from,
    to,
    rps,
    blocked,
    plane: opts.control ? 'control' : 'data',
    bandwidthMbps: LINK_BANDWIDTH_MBPS,
    utilization: parseFloat(utilization.toFixed(3)),
    latencyMs: Math.round(opts.latencyMs ?? 0),
    packetLoss: parseFloat(errorRate.toFixed(4)),
    trafficKind,
  };
}

export function getTopologySnapshot(): TopologySnapshot {
  const workerList = Array.from(workers.values());

  const apiRps = workerList.reduce((sum, w) => sum + getRps(w.name), 0);
  const apiLatency = workerList.length > 0
    ? Math.round(workerList.reduce((sum, w) => sum + w.avgLatency, 0) / workerList.length)
    : 0;
  const apiErrorRate = workerList.length > 0
    ? workerList.reduce((sum, w) => sum + w.errorRate, 0) / workerList.length
    : 0;

  const mkNode = (
    id: string,
    label: string,
    type: TopologyNode['type'],
    health: TopologyNode['health'],
    metrics: TopologyNode['metrics']
  ): TopologyNode => ({
    id,
    label,
    type,
    plane: planeFor(id),
    health,
    deviceType: deviceTypeFor(id, type),
    ip: synthIp(id),
    mac: synthMac(id),
    metrics,
  });

  const nodes: TopologyNode[] = [
    mkNode('browser', 'Browser', 'client', 'healthy', {
      rps: Math.round(apiRps), avgLatency: 0, errorRate: 0, inFlight: 0, activeFlows: 0,
    }),
    mkNode(
      'api',
      'api-vendas',
      'api',
      workerList.some((w) => calculateHealth(w) === 'critical') ? 'degraded' : 'healthy',
      { rps: Math.round(apiRps), avgLatency: apiLatency, errorRate: parseFloat(apiErrorRate.toFixed(4)), inFlight: 0, activeFlows: workerList.reduce((s, w) => s + w.inFlight, 0) }
    ),
    ...workerList.map((w) =>
      mkNode(w.name, w.name, 'worker', calculateHealth(w), {
        rps: Math.round(getRps(w.name)),
        avgLatency: Math.round(w.avgLatency),
        errorRate: parseFloat(w.errorRate.toFixed(4)),
        inFlight: w.inFlight,
        activeFlows: w.inFlight,
      })
    ),
    mkNode('postgres', 'PostgreSQL', 'db', 'healthy', {
      rps: Math.round(apiRps), avgLatency: 0, errorRate: 0, inFlight: 0, activeFlows: 0,
    }),
    mkNode('datadog', 'Datadog Agent', 'datadog', 'healthy', {
      rps: 0, avgLatency: 0, errorRate: 0, inFlight: 0, activeFlows: 0,
    }),
  ];

  const edges: TopologyEdge[] = [
    buildEdge('browser', 'api', Math.round(apiRps), { latencyMs: apiLatency, errorRate: apiErrorRate }),
    ...workerList.map((w) =>
      buildEdge('api', w.name, Math.round(getRps(w.name)), {
        blocked: w.blocked,
        latencyMs: w.avgLatency,
        errorRate: w.errorRate,
      })
    ),
    ...workerList.map((w) =>
      buildEdge(w.name, 'postgres', Math.round(getRps(w.name)), {
        blocked: w.blocked,
        latencyMs: w.avgLatency,
        errorRate: w.errorRate,
      })
    ),
    buildEdge('postgres', 'datadog', 0, { control: true }),
  ];

  // Aplica overrides: nos desabilitados -> arestas bloqueadas
  for (const edge of edges) {
    const src = nodeOverrides.get(edge.from);
    const dst = nodeOverrides.get(edge.to);
    if (src?.disabled || dst?.disabled) {
      edge.blocked = true;
    }
  }

  // Aplica overrides de health nos nos
  for (const node of nodes) {
    const override = nodeOverrides.get(node.id);
    if (override) {
      if (override.disabled) node.health = 'blocked';
      else if (override.health) node.health = override.health;
    }
  }

  const allRules = flowRules.getRules();
  const activeRules = allRules
    .filter((r) => r.enabled && r.stats.matched > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      matchCount: r.stats.matched,
    }));

  return {
    timestamp: new Date().toISOString(),
    nodes,
    edges,
    activeRules,
  };
}
