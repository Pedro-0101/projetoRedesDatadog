import StatsD from 'hot-shots';

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(tokens = 1, allowQueue = true): number {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return 0;
    }
    if (!allowQueue) return -1;
    const waitMs = Math.ceil(((tokens - this.tokens) / this.refillRate) * 1000);
    this.tokens = 0;
    return waitMs;
  }

  level(): number {
    this.refill();
    return this.tokens / this.capacity;
  }

  getCapacity(): number {
    return this.capacity;
  }

  getRefillRate(): number {
    return this.refillRate;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

interface BucketConfig {
  capacity: number;
  refillRate: number;
}

interface ShapingState {
  enabled: boolean;
  mode: 'shape' | 'drop';
  buckets: Record<string, { level: number; capacity: number; refillRate: number }>;
}

const DEFAULT_BUCKETS: Record<string, BucketConfig> = {
  global: { capacity: 80, refillRate: 60 },
  'worker-a': { capacity: 30, refillRate: 30 },
  'worker-b': { capacity: 30, refillRate: 30 },
  'worker-c': { capacity: 30, refillRate: 30 },
};

let enabled = false;
let mode: 'shape' | 'drop' = 'shape';

const buckets: Map<string, TokenBucket> = new Map(
  Object.entries(DEFAULT_BUCKETS).map(([name, cfg]) => [
    name,
    new TokenBucket(cfg.capacity, cfg.refillRate),
  ])
);

function logJSON(level: string, message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
      shaping: true,
    }) + '\n'
  );
}

function emitMetrics(bucketName: string, waitMs: number, action: 'allowed' | 'throttled' | 'dropped'): void {
  const tags = [`bucket:${bucketName}`, 'env:dev'];

  statsd.increment(`sdn.shaping.${action}`, 1, tags);

  if (waitMs > 0) {
    statsd.histogram('sdn.shaping.wait_ms', waitMs, tags);
  }

  const bucket = buckets.get(bucketName);
  if (bucket) {
    statsd.gauge('sdn.shaping.token_level', bucket.level(), tags);
  }
}

export function isEnabled(): boolean {
  return enabled;
}

export function getMode(): 'shape' | 'drop' {
  return mode;
}

export function consume(bucketName: string): number {
  const bucket = buckets.get(bucketName);
  if (!bucket) return 0;

  const waitMs = bucket.consume(1, mode === 'shape');

  if (waitMs === 0) {
    emitMetrics(bucketName, 0, 'allowed');
  } else if (waitMs === -1) {
    emitMetrics(bucketName, 0, 'dropped');
  } else {
    emitMetrics(bucketName, waitMs, 'throttled');
  }

  return waitMs;
}

export function check(workerName: string): number {
  if (!enabled) return 0;

  const globalWait = consume('global');
  if (globalWait !== 0) return globalWait;

  const workerWait = consume(workerName);
  return workerWait;
}

export function getState(): ShapingState {
  const bucketStates: Record<string, { level: number; capacity: number; refillRate: number }> = {};
  for (const [name, bucket] of buckets) {
    bucketStates[name] = {
      level: parseFloat(bucket.level().toFixed(4)),
      capacity: bucket.getCapacity(),
      refillRate: bucket.getRefillRate(),
    };
  }

  return {
    enabled,
    mode,
    buckets: bucketStates,
  };
}

export function config(bucketName: string, cfg: Partial<BucketConfig>): boolean {
  const bucket = buckets.get(bucketName);
  if (!bucket) return false;

  const newBucket = new TokenBucket(
    cfg.capacity ?? bucket.getCapacity(),
    cfg.refillRate ?? bucket.getRefillRate()
  );
  buckets.set(bucketName, newBucket);

  logJSON('info', 'Bucket config updated', { bucket: bucketName, config: cfg });
  return true;
}

export function enable(): void {
  enabled = true;
  logJSON('info', 'Traffic shaping enabled');
}

export function disable(): void {
  enabled = false;
  logJSON('info', 'Traffic shaping disabled');
}

export function reset(): void {
  for (const bucket of buckets.values()) {
    bucket.reset();
  }
  logJSON('info', 'All token buckets reset to full');
}
