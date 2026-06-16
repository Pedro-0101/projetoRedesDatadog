import axios from 'axios';
import StatsD from 'hot-shots';
import type { Response } from 'express';
import { getAttack, SQLI_PAYLOADS, TRAVERSAL_PATHS, COMMON_PASSWORDS } from './attacks';

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

const SELF_URL = process.env.SELF_URL ?? `http://localhost:${process.env.PORT || 3003}`;

export interface AttackRequest {
  method: 'get' | 'post';
  url: string;
  data?: unknown;
  label: string;
}

export function buildAttackRequest(attackId: string, i: number): AttackRequest {
  switch (attackId) {
    case 'sql-injection': {
      const p = SQLI_PAYLOADS[i % SQLI_PAYLOADS.length];
      return { method: 'get', url: `${SELF_URL}/api/produtos/buscar?q=${encodeURIComponent(p)}`, label: p };
    }
    case 'path-traversal': {
      const p = TRAVERSAL_PATHS[i % TRAVERSAL_PATHS.length];
      return { method: 'get', url: `${SELF_URL}/api/arquivos?path=${encodeURIComponent(p)}`, label: p };
    }
    case 'brute-force': {
      const senha = COMMON_PASSWORDS[i % COMMON_PASSWORDS.length];
      return { method: 'post', url: `${SELF_URL}/api/login`, data: { username: 'admin', senha }, label: `admin:${senha}` };
    }
    case 'exfiltracao': {
      const size = 100 * (i + 1);
      return { method: 'get', url: `${SELF_URL}/api/export?size=${size}`, label: `size=${size}` };
    }
    default:
      throw new Error('ataque desconhecido');
  }
}

interface AttackState {
  attackId: string;
  total: number;
  sent: number;
  blocked: number;
  ok: number;
  finished: boolean;
  cancelled: boolean;
}

const sseClients = new Map<string, Response>();
let state: AttackState | null = null;
let abort: AbortController | null = null;

export function registerAttackSSE(id: string, res: Response): void { sseClients.set(id, res); }
export function unregisterAttackSSE(id: string): void { sseClients.delete(id); }

function broadcast(event: string, data: object): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(payload); } catch { /* desconectado */ }
  }
}

export function startAttack(params: { attack: string; count?: number; concurrency?: number }): void {
  if (state && !state.finished) throw new Error('Um ataque ja esta em execucao');
  const def = getAttack(params.attack);
  if (!def) throw new Error('Ataque desconhecido');

  const total = params.count ?? def.defaultCount;
  const concurrency = params.concurrency ?? def.defaultConcurrency;
  abort = new AbortController();
  state = { attackId: def.id, total, sent: 0, blocked: 0, ok: 0, finished: false, cancelled: false };

  runAttack(def.id, total, concurrency, abort.signal).catch(() => {});
}

export function stopAttack(): void { abort?.abort(); }

async function runAttack(attackId: string, total: number, concurrency: number, signal: AbortSignal): Promise<void> {
  broadcast('attack-start', { attackId, total });
  let active = 0;
  let i = 0;
  const cur = state!;

  async function fireOne(index: number): Promise<void> {
    const req = buildAttackRequest(attackId, index);
    try {
      const res = await axios.request({
        method: req.method,
        url: req.url,
        data: req.data,
        validateStatus: () => true,
        signal,
      });
      const blocked = res.status === 403;
      cur.sent++;
      if (blocked) cur.blocked++; else cur.ok++;
      statsd.increment('ataque.requisicoes', 1, [`attack:${attackId}`, 'env:dev']);
      broadcast('attack-result', {
        attackId, index, status: res.status, blocked, label: req.label,
        stats: { sent: cur.sent, blocked: cur.blocked, ok: cur.ok },
      });
    } catch {
      cur.sent++;
      broadcast('attack-result', {
        attackId, index, status: 0, blocked: false, label: req.label,
        stats: { sent: cur.sent, blocked: cur.blocked, ok: cur.ok },
      });
    }
  }

  await new Promise<void>((resolve) => {
    function pump(): void {
      if (signal.aborted) { if (active === 0) resolve(); return; }
      while (active < concurrency && i < total) {
        const idx = i++;
        active++;
        fireOne(idx).finally(() => { active--; pump(); });
      }
      if (i >= total && active === 0) resolve();
    }
    pump();
  });

  cur.finished = true;
  cur.cancelled = signal.aborted;
  broadcast('attack-done', { attackId, sent: cur.sent, blocked: cur.blocked, ok: cur.ok, cancelled: cur.cancelled });
}
