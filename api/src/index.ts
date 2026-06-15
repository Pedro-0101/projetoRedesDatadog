import tracer from './tracer';
import express, { Request, Response } from 'express';
import StatsD from 'hot-shots';
import axios from 'axios';

const app = express();
app.use(express.json());

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

const port = 3000;
app.listen(port, () => logJSON('info', `API iniciada na porta ${port}`));
