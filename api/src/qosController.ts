import StatsD from 'hot-shots';
import { baseTags } from './ddTags';

export type Priority = 'gold' | 'silver' | 'bronze';

export const PRIORITIES: Priority[] = ['gold', 'silver', 'bronze'];

export interface QosConfig {
  maxConcurrency: Record<Priority, number>;
  maxQueueDepth: Record<Priority, number>;
}

export interface QosSlot {
  priority: Priority;
  acquiredAt: number;
}

export interface QosStats {
  config: QosConfig;
  queues: Record<Priority, { depth: number; slotsUsed: number; waiting: number }>;
  totalAcquired: number;
  totalThrottled: number;
  totalDropped: number;
  totalReleased: number;
}

interface QueueEntry {
  priority: Priority;
  resolve: () => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_CONFIG: QosConfig = {
  maxConcurrency: { gold: 20, silver: 10, bronze: 3 },
  maxQueueDepth: { gold: 100, silver: 50, bronze: 20 },
};

const DEFAULT_TIMEOUT_MS: Record<Priority, number> = {
  gold: 30000,
  silver: 15000,
  bronze: 5000,
};

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

let config: QosConfig = { ...DEFAULT_CONFIG };

const slotsInUse: Record<Priority, number> = { gold: 0, silver: 0, bronze: 0 };
const queues: Record<Priority, QueueEntry[]> = { gold: [], silver: [], bronze: [] };

let totalAcquired = 0;
let totalThrottled = 0;
let totalDropped = 0;
let totalReleased = 0;

const sseClients = new Set<(stats: QosStats) => void>();
let sseInterval: NodeJS.Timeout | null = null;

function broadcastStats(): void {
  const stats = getStats();
  for (const cb of sseClients) {
    try { cb(stats); } catch { }
  }

  for (const p of PRIORITIES) {
    statsd.gauge('qos.queue.depth', queues[p].length, baseTags(`priority:${p}`));
    statsd.gauge('qos.slots.used', slotsInUse[p], baseTags(`priority:${p}`));
  }
}

export function acquire(priority: Priority, timeoutMs?: number): Promise<void> {
  const ttl = timeoutMs ?? DEFAULT_TIMEOUT_MS[priority];

  if (slotsInUse[priority] < config.maxConcurrency[priority]) {
    slotsInUse[priority]++;
    totalAcquired++;
    return Promise.resolve();
  }

  if (queues[priority].length >= config.maxQueueDepth[priority]) {
    totalDropped++;
    statsd.increment('qos.request.dropped', 1, baseTags(`priority:${priority}`));
    return Promise.reject(new Error(`QoS queue full for ${priority}`));
  }

  totalThrottled++;
  statsd.increment('qos.request.throttled', 1, baseTags(`priority:${priority}`));

  return new Promise<void>((resolve, reject) => {
    const entry: QueueEntry = {
      priority,
      resolve: () => {
        slotsInUse[priority]++;
        totalAcquired++;
        resolve();
      },
      reject: (err: Error) => reject(err),
      timeout: setTimeout(() => {
        const idx = queues[priority].indexOf(entry);
        if (idx >= 0) {
          queues[priority].splice(idx, 1);
        }
        totalDropped++;
        statsd.increment('qos.request.dropped', 1, baseTags(`priority:${priority}`));
        reject(new Error(`QoS timeout for ${priority}`));
      }, ttl),
    };
    queues[priority].push(entry);
  });
}

export function release(priority: Priority): void {
  slotsInUse[priority] = Math.max(0, slotsInUse[priority] - 1);
  totalReleased++;

  const next = queues[priority].shift();
  if (next) {
    clearTimeout(next.timeout);
    next.resolve();
  }

  statsd.histogram('qos.request.latency', Date.now(), baseTags(`priority:${priority}`));
}

export function getStats(): QosStats {
  return {
    config: { ...config },
    queues: {
      gold: { depth: queues.gold.length, slotsUsed: slotsInUse.gold, waiting: queues.gold.length },
      silver: { depth: queues.silver.length, slotsUsed: slotsInUse.silver, waiting: queues.silver.length },
      bronze: { depth: queues.bronze.length, slotsUsed: slotsInUse.bronze, waiting: queues.bronze.length },
    },
    totalAcquired,
    totalThrottled,
    totalDropped,
    totalReleased,
  };
}

export function updateConfig(newConfig: Partial<QosConfig>): QosConfig {
  if (newConfig.maxConcurrency) {
    config.maxConcurrency = { ...config.maxConcurrency, ...newConfig.maxConcurrency };
  }
  if (newConfig.maxQueueDepth) {
    config.maxQueueDepth = { ...config.maxQueueDepth, ...newConfig.maxQueueDepth };
  }
  logJSON('info', 'QoS config updated', { config });
  return { ...config };
}

export function resetStats(): void {
  totalAcquired = 0;
  totalThrottled = 0;
  totalDropped = 0;
  totalReleased = 0;
}

function logJSON(level: string, message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
      qos: true,
    }) + '\n'
  );
}

export function registerQosSSE(cb: (stats: QosStats) => void): () => void {
  sseClients.add(cb);

  if (!sseInterval) {
    sseInterval = setInterval(broadcastStats, 1000);
  }

  return () => {
    sseClients.delete(cb);
    if (sseClients.size === 0 && sseInterval) {
      clearInterval(sseInterval);
      sseInterval = null;
    }
  };
}
