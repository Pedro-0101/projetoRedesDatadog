import axios from 'axios';
import StatsD from 'hot-shots';
import tracer from './tracer';
import { inserirVenda } from './db';
import { behaviorHeaders } from './behavior';
import { TestParams, TestState, getScenario } from './scenarios';
import type { Response } from 'express';
import { route as sdnRoute, getWorkerStats } from './sdnController';
import type { Priority } from './qosController';

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
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
    }) + '\n'
  );
}

function getEffectiveErrorRate(params: TestParams, index: number): number {
  if (!params.cascading) return params.errorRate;
  const start = 0.05;
  const end = 0.95;
  const progress = params.count <= 1 ? 1 : index / (params.count - 1);
  return start + (end - start) * progress;
}

const PRIORITY_POOLS: Record<string, Priority[]> = {
  'mixed': [
    ...Array(50).fill('gold'),
    ...Array(30).fill('silver'),
    ...Array(20).fill('bronze'),
  ],
};

function resolvePriority(priority: string | undefined, index: number, total: number): Priority | undefined {
  if (!priority || priority === 'silver' || priority === 'gold' || priority === 'bronze') {
    return priority as Priority | undefined;
  }
  if (priority === 'mixed') {
    const pool = PRIORITY_POOLS['mixed'];
    return pool[index % pool.length];
  }
  return undefined;
}

const sseClients = new Map<string, Response>();
let currentState: TestState | null = null;
let abortController: AbortController | null = null;

export function registerSSEClient(id: string, res: Response): void {
  sseClients.set(id, res);
}

export function unregisterSSEClient(id: string): void {
  sseClients.delete(id);
}

export function getCurrentState(): TestState | null {
  return currentState;
}

function broadcast(event: string, data: object): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try {
      res.write(payload);
    } catch {
      // client disconnected
    }
  }
}

export async function startTest(params: TestParams): Promise<string> {
  if (currentState && !currentState.finished) {
    throw new Error('Um teste ja esta em execucao');
  }

  const testId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  abortController = new AbortController();

  currentState = {
    testId,
    params,
    scenarioId: params.scenario ?? 'custom',
    startedAt: Date.now(),
    total: params.count,
    sent: 0,
    success: 0,
    errors: 0,
    inFlight: 0,
    latencies: [],
    cancelled: false,
    finished: false,
  };

  runBatch(currentState, abortController.signal).catch((err) => {
    logJSON('error', 'Batch de teste falhou', { error: err instanceof Error ? err.message : String(err) });
  });

  return testId;
}

export function stopTest(): void {
  abortController?.abort();
}

async function runBatch(state: TestState, signal: AbortSignal): Promise<void> {
  const sem = new Semaphore(state.params.concurrency);

  // Reseta todos os workers (leak/degradacao/cold) para repetibilidade.
  const coldArg = state.params.behavior === 'cold-start' ? '?cold=15' : '';
  for (const ws of getWorkerStats()) {
    await axios.post(`${ws.url}/reset${coldArg}`).catch(() => {});
  }

  broadcast('start', {
    testId: state.testId,
    total: state.total,
    scenario: state.scenarioId,
    startedAt: state.startedAt,
  });

  const promises: Promise<void>[] = [];

  for (let i = 0; i < state.total; i++) {
    if (signal.aborted) break;

    const index = i;
    const promise = (async () => {
      await sem.acquire();
      if (signal.aborted) {
        sem.release();
        return;
      }

      state.inFlight++;
      const effectiveRate = getEffectiveErrorRate(state.params, index);
      const t0 = Date.now();

      const effectivePriority = resolvePriority(state.params.priority, index, state.total);

      try {
        const result = await sdnRoute(
          {
            teste: true,
            index,
            errorRate: effectiveRate,
            minDelay: state.params.minDelay,
            maxDelay: state.params.maxDelay,
            behavior: state.params.behavior,
            priority: effectivePriority,
          },
          effectivePriority
        );

        const latency = Date.now() - t0;
        const success = result.response.status >= 200 && result.response.status < 300;

        state.sent++;
        state.latencies.push(latency);

        if (success) {
          state.success++;
          statsd.increment('teste.sucessos', 1, [`scenario:${state.scenarioId}`, 'env:dev']);
          inserirVenda('produto-teste', 100, `cliente-${index}`).catch(() => {});
        } else {
          state.errors++;
          statsd.increment('teste.erros', 1, [`scenario:${state.scenarioId}`, 'env:dev']);
        }

        statsd.histogram('test.latencia', latency, [`scenario:${state.scenarioId}`, 'env:dev']);

        const avgLatency =
          state.latencies.length > 0
            ? Math.round(state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length)
            : 0;

        broadcast('result', {
          testId: state.testId,
          index,
          worker: result.worker,
          statusCode: result.response.status,
          latency,
          success,
          timestamp: new Date().toISOString(),
          stats: {
            sent: state.sent,
            success: state.success,
            errors: state.errors,
            inFlight: Math.max(0, state.inFlight - 1),
            avgLatency,
            successRate:
              state.sent > 0
                ? parseFloat(((state.success / state.sent) * 100).toFixed(1))
                : 0,
          },
        });
      } catch (err: unknown) {
        if (signal.aborted) {
          sem.release();
          state.inFlight--;
          return;
        }
        state.errors++;
        state.sent++;
        statsd.increment('teste.erros', 1, [`scenario:${state.scenarioId}`, 'env:dev']);
        broadcast('error', {
          testId: state.testId,
          message: err instanceof Error ? err.message : 'unknown',
          index,
        });
      } finally {
        state.inFlight--;
        sem.release();
      }
    })();

    promises.push(promise);
  }

  await Promise.allSettled(promises);

  state.finished = true;
  state.cancelled = signal.aborted;

  const avgLatency =
    state.latencies.length > 0
      ? Math.round(state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length)
      : 0;

  statsd.gauge('teste.cenario', state.success, [`scenario:${state.scenarioId}`, 'env:dev']);

  broadcast('done', {
    testId: state.testId,
    total: state.total,
    success: state.success,
    errors: state.errors,
    avgLatency,
    duration: Date.now() - state.startedAt,
    cancelled: state.cancelled,
  });

  logJSON('info', 'Batch de teste concluido', {
    testId: state.testId,
    scenario: state.scenarioId,
    total: state.total,
    success: state.success,
    errors: state.errors,
    avgLatency,
    cancelled: state.cancelled,
  });
}

export { getScenario };
