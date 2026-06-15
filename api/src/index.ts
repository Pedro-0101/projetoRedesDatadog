import tracer from './tracer';
import express, { Request, Response } from 'express';
import StatsD from 'hot-shots';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import {
  registerSSEClient,
  unregisterSSEClient,
  startTest,
  stopTest,
  getCurrentState,
} from './testRunner';
import { SCENARIOS, getScenario } from './scenarios';
import type { TestParams } from './scenarios';
import {
  ATTACKS,
} from './attacks';
import {
  startAttack,
  stopAttack,
  registerAttackSSE,
  unregisterAttackSSE,
} from './attackRunner';
import { buscarProdutos, buscarUsuario } from './db';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const statsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  errorHandler: (err) => logJSON('error', `DogStatsD connection error: ${err.message}`),
});

function getTraceContext(): Record<string, string> {
  const span = tracer.scope().active();
  if (!span) return {};
  const ctx = span.context();
  return {
    'dd.trace_id': ctx.toTraceId(),
    'dd.span_id': ctx.toSpanId(),
  };
}

function logJSON(level: string, message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...getTraceContext(),
      ...extra,
    }) + '\n'
  );
}

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List scenarios
app.get('/api/scenarios', (_req: Request, res: Response) => {
  res.json(SCENARIOS);
});

// SSE stream for real-time test events
app.get('/api/test/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  registerSSEClient(clientId, res);

  // Send current state if a test is running
  const state = getCurrentState();
  if (state && !state.finished) {
    const avgLatency =
      state.latencies.length > 0
        ? Math.round(state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length)
        : 0;
    res.write(
      `event: reconnect\ndata: ${JSON.stringify({
        testId: state.testId,
        total: state.total,
        scenario: state.scenarioId,
        stats: {
          sent: state.sent,
          success: state.success,
          errors: state.errors,
          inFlight: state.inFlight,
          avgLatency,
          successRate:
            state.sent > 0
              ? parseFloat(((state.success / state.sent) * 100).toFixed(1))
              : 0,
        },
      })}\n\n`
    );
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterSSEClient(clientId);
  });
});

// Start a test batch
app.post('/api/test/run', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    let params: TestParams;

    if (body.scenario) {
      const preset = getScenario(body.scenario);
      if (!preset) {
        res.status(400).json({ error: 'Cenario desconhecido' });
        return;
      }
      params = {
        scenario: preset.id,
        count: body.count != null ? Number(body.count) : preset.count,
        errorRate: body.errorRate != null ? Number(body.errorRate) : preset.errorRate,
        minDelay: body.minDelay != null ? Number(body.minDelay) : preset.minDelay,
        maxDelay: body.maxDelay != null ? Number(body.maxDelay) : preset.maxDelay,
        concurrency: body.concurrency != null ? Number(body.concurrency) : preset.concurrency,
        cascading: preset.cascading,
        behavior: preset.behavior,
      };
    } else {
      params = {
        count: Number(body.count) || 100,
        errorRate: body.errorRate != null ? Number(body.errorRate) : 0.1,
        minDelay: Number(body.minDelay) || 100,
        maxDelay: Number(body.maxDelay) || 1000,
        concurrency: Number(body.concurrency) || 10,
        cascading: false,
      };
    }

    const testId = await startTest(params);
    logJSON('info', 'Teste iniciado', { testId, params });
    res.json({ testId, params });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    res.status(409).json({ error: message });
  }
});

// Stop the current test
app.post('/api/test/stop', (_req: Request, res: Response) => {
  stopTest();
  logJSON('info', 'Teste cancelado pelo usuario');
  res.json({ status: 'stopped' });
});

// Existing purchase endpoint (kept for compatibility)
app.post('/comprar', async (req: Request, res: Response) => {
  logJSON('info', 'Requisicao de compra recebida', { body: req.body });

  statsd.increment('vendas.total', 1, ['env:dev', 'service:api-vendas']);

  try {
    await axios.post(`${process.env.WORKER_URL}/processar`, req.body);
    logJSON('info', 'Processamento confirmado pelo worker');
    res.json({ status: 'processado' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logJSON('error', 'Falha ao chamar worker', { error: message });
    res.status(500).json({ error: 'Falha no processamento' });
  }
});

// DEMO: busca de produtos — usa SQL concatenado (alvo de SQLi na Etapa 3).
app.get('/api/produtos/buscar', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  try {
    const produtos = await buscarProdutos(q);
    res.json({ produtos });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    logJSON('error', 'Falha na busca de produtos', { error: message, q });
    res.status(500).json({ error: message });
  }
});

// Catálogo de ataques
app.get('/api/attack/list', (_req: Request, res: Response) => {
  res.json(ATTACKS);
});

// SSE de eventos de ataque
app.get('/api/attack/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  registerAttackSSE(clientId, res);
  req.on('close', () => unregisterAttackSSE(clientId));
});

// Inicia uma simulação de ataque
app.post('/api/attack/run', (req: Request, res: Response) => {
  try {
    const { attack, count, concurrency } = req.body ?? {};
    startAttack({
      attack: String(attack),
      count: count != null ? Number(count) : undefined,
      concurrency: concurrency != null ? Number(concurrency) : undefined,
    });
    logJSON('info', 'Ataque iniciado', { attack });
    res.json({ status: 'started', attack });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    res.status(409).json({ error: message });
  }
});

// Para a simulação atual
app.post('/api/attack/stop', (_req: Request, res: Response) => {
  stopAttack();
  res.json({ status: 'stopped' });
});

// DEMO: endpoints intencionalmente vulneráveis — apenas com DEMO_VULN_ENDPOINTS=true.
const vulnEnabled = (): boolean => process.env.DEMO_VULN_ENDPOINTS === 'true';

// Path traversal: lê arquivo a partir de caminho não sanitizado.
app.get('/api/arquivos', (req: Request, res: Response) => {
  if (!vulnEnabled()) { res.status(404).end(); return; }
  const userPath = String(req.query.path ?? '');
  const full = path.join(__dirname, '..', 'public', userPath);
  fs.readFile(full, 'utf8', (err, data) => {
    if (err) { res.status(404).json({ error: 'not found' }); return; }
    res.type('text/plain').send(data);
  });
});

// Brute force: login sem rate limiting, senha em texto plano.
app.post('/api/login', async (req: Request, res: Response) => {
  if (!vulnEnabled()) { res.status(404).end(); return; }
  const { username, senha } = req.body ?? {};
  try {
    const user = await buscarUsuario(String(username ?? ''));
    if (user && user.senha === senha) { res.json({ token: 'demo-token' }); return; }
    res.status(401).json({ error: 'credenciais invalidas' });
  } catch {
    res.status(500).json({ error: 'erro' });
  }
});

// Exfiltração: retorna payloads de tamanho crescente.
app.get('/api/export', (req: Request, res: Response) => {
  if (!vulnEnabled()) { res.status(404).end(); return; }
  const size = Math.min(Number(req.query.size) || 100, 100000);
  const rows = Array.from({ length: size }, (_, i) => ({ id: i, dado: 'x'.repeat(50) }));
  res.json({ rows });
});

// SPA fallback
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const port = Number(process.env.PORT) || 3003;
app.listen(port, () => logJSON('info', `API iniciada na porta ${port}`));
