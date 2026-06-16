import StatsD from 'hot-shots';
import axios from 'axios';
import tracer from './tracer';
import * as qos from './qosController';
import * as flowRules from './flowRules';
import * as shaping from './tokenBucket';

const WINDOW_SIZE = 20;
const HEALTHY_THRESHOLD_LATENCY = 500;
const DEGRADED_THRESHOLD_LATENCY = 2000;
const DEGRADED_THRESHOLD_ERROR = 0.25;
const STALE_TIMEOUT_MS = 30000;

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
    },
  ])
);

const sseClients = new Set<(event: SdnEvent) => void>();
let roundRobinIndex = 0;

function broadcastSdnEvent(event: SdnEvent): void {
  for (const cb of sseClients) {
    try { cb(event); } catch { /* ignore */ }
  }
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
  statsd.gauge('sdn.route.blocked', 1, [`worker:${name}`, 'env:dev']);
  logJSON('warn', 'Worker bloqueado manualmente', { worker: name, sdn_route_change: true });
  broadcastSdnEvent({
    type: 'worker_blocked',
    worker: name,
    timestamp: new Date().toISOString(),
    details: {},
  });
  return true;
}

export function unblockWorker(name: string): boolean {
  const w = workers.get(name);
  if (!w) return false;
  w.blocked = false;
  statsd.gauge('sdn.route.blocked', 0, [`worker:${name}`, 'env:dev']);
  logJSON('info', 'Worker reativado', { worker: name, sdn_route_change: true });
  broadcastSdnEvent({
    type: 'worker_unblocked',
    worker: name,
    timestamp: new Date().toISOString(),
    details: {},
  });
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

  incrementCounter('sdn.route.selected', [`worker:${decision.worker}`, `reason:${decision.reason}`, 'env:dev']);

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
    incrementCounter('sdn.route.rerouted', [`from_worker:${decision.worker}`, `to_worker:${decision.alternatives[0] ?? 'none'}`, 'env:dev']);
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
  }

  statsd.histogram('sdn.worker.latency', latency, [`worker:${decision.worker}`, 'env:dev']);

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

interface TopologyNode {
  id: string;
  label: string;
  type: 'client' | 'api' | 'worker' | 'db' | 'datadog';
  health: 'healthy' | 'degraded' | 'critical' | 'blocked' | 'unknown';
  metrics: {
    rps: number;
    avgLatency: number;
    errorRate: number;
    inFlight: number;
  };
}

interface TopologyEdge {
  from: string;
  to: string;
  rps: number;
  blocked: boolean;
  activeRuleId?: string;
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

  if (w.recentLatencies.length > WINDOW_SIZE) {
    w.recentLatencies.shift();
    w.recentErrors.shift();
  }

  w.avgLatency =
    w.recentLatencies.reduce((a, b) => a + b, 0) / w.recentLatencies.length;
  w.errorRate =
    w.recentErrors.reduce((a, b) => a + (b ? 1 : 0), 0) / w.recentErrors.length;

  statsd.histogram('sdn.worker.latency', latencyMs, [`worker:${workerName}`, 'env:dev']);
  statsd.gauge('sdn.worker.error_rate', w.errorRate, [`worker:${workerName}`, 'env:dev']);

  trackRps(workerName);
}

export function getTopologySnapshot(): TopologySnapshot {
  const workerList = Array.from(workers.values());

  const apiRps = workerList.reduce((sum, w) => sum + getRps(w.name), 0);
  const apiLatency = workerList.length > 0
    ? Math.round(workerList.reduce((sum, w) => sum + w.avgLatency, 0) / workerList.length)
    : 0;

  const nodes: TopologyNode[] = [
    {
      id: 'browser',
      label: 'Browser',
      type: 'client',
      health: 'healthy',
      metrics: { rps: Math.round(apiRps), avgLatency: 0, errorRate: 0, inFlight: 0 },
    },
    {
      id: 'api',
      label: 'api-vendas',
      type: 'api',
      health: workerList.some((w) => calculateHealth(w) === 'critical') ? 'degraded' : 'healthy',
      metrics: { rps: Math.round(apiRps), avgLatency: apiLatency, errorRate: 0, inFlight: 0 },
    },
    ...workerList.map((w) => ({
      id: w.name,
      label: w.name,
      type: 'worker' as const,
      health: calculateHealth(w),
      metrics: {
        rps: Math.round(getRps(w.name)),
        avgLatency: Math.round(w.avgLatency),
        errorRate: parseFloat(w.errorRate.toFixed(4)),
        inFlight: w.inFlight,
      },
    })),
    {
      id: 'postgres',
      label: 'PostgreSQL',
      type: 'db',
      health: 'healthy',
      metrics: { rps: Math.round(apiRps), avgLatency: 0, errorRate: 0, inFlight: 0 },
    },
    {
      id: 'datadog',
      label: 'Datadog Agent',
      type: 'datadog',
      health: 'healthy',
      metrics: { rps: 0, avgLatency: 0, errorRate: 0, inFlight: 0 },
    },
  ];

  const edges: TopologyEdge[] = [
    { from: 'browser', to: 'api', rps: Math.round(apiRps), blocked: false },
    ...workerList.map((w) => ({
      from: 'api',
      to: w.name,
      rps: Math.round(getRps(w.name)),
      blocked: w.blocked,
    })),
    ...workerList.map((w) => ({
      from: w.name,
      to: 'postgres',
      rps: Math.round(getRps(w.name)),
      blocked: w.blocked,
    })),
    { from: 'postgres', to: 'datadog', rps: 0, blocked: false },
  ];

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
