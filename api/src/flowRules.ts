import StatsD from 'hot-shots';
import tracer from './tracer';

export type FlowCondition =
  | { type: 'latency_above'; worker: string; thresholdMs: number }
  | { type: 'error_rate_above'; worker: string; threshold: number }
  | { type: 'tag'; key: string; value: string }
  | { type: 'priority'; is: 'gold' | 'silver' | 'bronze' }
  | { type: 'always' };

export type FlowAction =
  | { type: 'redirect'; toWorker: string }
  | { type: 'drop' }
  | { type: 'add_delay'; ms: number }
  | { type: 'set_priority'; to: 'gold' | 'silver' | 'bronze' }
  | { type: 'allow' };

export interface FlowRule {
  id: string;
  name: string;
  priority: number;
  condition: FlowCondition;
  action: FlowAction;
  enabled: boolean;
  stats: {
    matched: number;
    lastMatchedAt?: string;
  };
}

export interface FlowContext {
  priority?: string;
  [key: string]: unknown;
}

export interface WorkerStatsBrief {
  name: string;
  avgLatency: number;
  errorRate: number;
  inFlight: number;
  blocked: boolean;
}

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: () => {},
});

let ruleIdCounter = 5;

const DEFAULT_RULES: FlowRule[] = [
  {
    id: 'r001',
    name: 'Desvio por latência',
    priority: 100,
    condition: { type: 'latency_above', worker: 'worker-a', thresholdMs: 800 },
    action: { type: 'redirect', toWorker: 'worker-b' },
    enabled: true,
    stats: { matched: 0 },
  },
  {
    id: 'r002',
    name: 'Failover por erro',
    priority: 90,
    condition: { type: 'error_rate_above', worker: 'worker-b', threshold: 0.50 },
    action: { type: 'redirect', toWorker: 'worker-c' },
    enabled: true,
    stats: { matched: 0 },
  },
  {
    id: 'r003',
    name: 'Gold sempre permitido',
    priority: 80,
    condition: { type: 'priority', is: 'gold' },
    action: { type: 'allow' },
    enabled: true,
    stats: { matched: 0 },
  },
  {
    id: 'r004',
    name: 'Drop em sobrecarga total',
    priority: 70,
    condition: { type: 'always' },
    action: { type: 'drop' },
    enabled: false,
    stats: { matched: 0 },
  },
];

let rules: FlowRule[] = [...DEFAULT_RULES];

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
      flow_rule: true,
    }) + '\n'
  );
}

function evaluateCondition(cond: FlowCondition, ctx: FlowContext, workers: WorkerStatsBrief[]): boolean {
  switch (cond.type) {
    case 'latency_above': {
      const w = workers.find((w) => w.name === cond.worker);
      return w ? w.avgLatency > cond.thresholdMs : false;
    }
    case 'error_rate_above': {
      const w = workers.find((w) => w.name === cond.worker);
      return w ? w.errorRate > cond.threshold : false;
    }
    case 'tag':
      return String(ctx[cond.key] ?? '') === cond.value;
    case 'priority':
      return ctx.priority === cond.is;
    case 'always':
      return true;
    default:
      return false;
  }
}

export function evaluate(
  ctx: FlowContext,
  workers: WorkerStatsBrief[]
): { action: FlowAction; rule: FlowRule } | null {
  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    if (evaluateCondition(rule.condition, ctx, workers)) {
      rule.stats.matched++;
      rule.stats.lastMatchedAt = new Date().toISOString();

      statsd.increment('sdn.flow_rule.matched', 1, [`rule_id:${rule.id}`, `rule_name:${rule.name}`, 'env:dev']);

      if (rule.action.type === 'redirect') {
        statsd.increment('sdn.flow_rule.redirected', 1, [`rule_id:${rule.id}`, `from:current`, `to:${rule.action.toWorker}`, 'env:dev']);
      } else if (rule.action.type === 'drop') {
        statsd.increment('sdn.flow_rule.dropped', 1, [`rule_id:${rule.id}`, 'env:dev']);
      } else if (rule.action.type === 'add_delay') {
        statsd.increment('sdn.flow_rule.delayed', 1, [`rule_id:${rule.id}`, `delay_ms:${rule.action.ms}`, 'env:dev']);
      }

      logJSON('info', 'Flow rule matched', {
        flow_rule_id: rule.id,
        flow_rule_name: rule.name,
        flow_rule_action: rule.action.type,
      });

      if (rule.action.type === 'allow') return null;

      return { action: rule.action, rule };
    }
  }

  return null;
}

export function getRules(): FlowRule[] {
  return rules.map((r) => ({ ...r }));
}

export function getRule(id: string): FlowRule | undefined {
  const r = rules.find((rule) => rule.id === id);
  return r ? { ...r } : undefined;
}

export function addRule(
  input: Omit<FlowRule, 'id' | 'stats'>
): FlowRule {
  const id = `r${String(ruleIdCounter++).padStart(3, '0')}`;
  const rule: FlowRule = {
    ...input,
    id,
    stats: { matched: 0 },
  };
  rules.push(rule);
  logJSON('info', 'Flow rule created', { flow_rule_id: id, flow_rule_name: rule.name });
  return { ...rule };
}

export function updateRule(id: string, updates: Partial<Omit<FlowRule, 'id' | 'stats'>>): FlowRule | null {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return null;

  rules[idx] = {
    ...rules[idx],
    ...updates,
    id,
    stats: rules[idx].stats,
  };

  logJSON('info', 'Flow rule updated', { flow_rule_id: id });
  return { ...rules[idx] };
}

export function deleteRule(id: string): boolean {
  const len = rules.length;
  rules = rules.filter((r) => r.id !== id);
  if (rules.length === len) return false;
  logJSON('info', 'Flow rule deleted', { flow_rule_id: id });
  return true;
}

export function testRule(
  id: string,
  ctx: FlowContext,
  workers: WorkerStatsBrief[]
): { matched: boolean; action?: FlowAction; rule?: FlowRule } {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return { matched: false };
  if (!rule.enabled) return { matched: false };

  const result = evaluateCondition(rule.condition, ctx, workers);
  if (!result) return { matched: false };

  return { matched: true, action: rule.action, rule: { ...rule } };
}

export function resetRuleStats(): void {
  for (const r of rules) {
    r.stats.matched = 0;
    r.stats.lastMatchedAt = undefined;
  }
}
