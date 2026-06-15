# Etapa 3 — Simulações de ataque + Application Security (ASM) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar 4 simulações de ataque (`sql-injection`, `path-traversal`, `brute-force`, `exfiltracao`) que disparam contra endpoints propositalmente vulneráveis da própria API, gerando Security Signals reais no Datadog ASM.

**Architecture:** Endpoints vulneráveis-por-design ficam atrás da flag `DEMO_VULN_ENDPOINTS=true`. Um `attackRunner` dispara requisições maliciosas contra a própria API (via `SELF_URL`), que passam pelo middleware Express instrumentado → o ASM (`DD_APPSEC_ENABLED=true`, ligado na Etapa 0) detecta. Eventos transmitidos via SSE próprio (`/api/attack/events`).

**Tech Stack:** Express, axios, dd-trace AppSec/ASM, hot-shots, vitest.

> ⚠️ **Os endpoints abaixo são intencionalmente inseguros, apenas para a demo.** Ficam atrás de `DEMO_VULN_ENDPOINTS` (desligados por padrão) e restritos à rede Docker local. **Nunca expor publicamente.**

**Pré-requisitos:** Etapas 0 e 1 concluídas (ASM ativo, Postgres + `usuarios`/`produtos`).

---

### Task 1: Catálogo de ataques (TDD)

**Files:**
- Create: `api/src/attacks.ts`
- Test: `api/src/attacks.test.ts`

- [ ] **Step 1: Escrever o teste (falha — módulo não existe)**

Create `api/src/attacks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ATTACKS, getAttack, SQLI_PAYLOADS, TRAVERSAL_PATHS, COMMON_PASSWORDS } from './attacks';

describe('catálogo de ataques', () => {
  it('contém os 4 ataques', () => {
    expect(ATTACKS.map((a) => a.id).sort()).toEqual([
      'brute-force',
      'exfiltracao',
      'path-traversal',
      'sql-injection',
    ]);
  });

  it('getAttack retorna por id', () => {
    expect(getAttack('sql-injection')?.feature).toBe('ASM');
    expect(getAttack('inexistente')).toBeUndefined();
  });

  it('listas de payload são não-vazias e têm vetores clássicos', () => {
    expect(SQLI_PAYLOADS.some((p) => p.includes("OR '1'='1"))).toBe(true);
    expect(TRAVERSAL_PATHS.some((p) => p.includes('etc/passwd'))).toBe(true);
    expect(COMMON_PASSWORDS).toContain('admin123');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run (em `api/`):
```bash
npm test -- src/attacks.test.ts
```
Expected: FAIL — `Failed to resolve import './attacks'`.

- [ ] **Step 3: Implementar `attacks.ts`**

Create `api/src/attacks.ts`:
```ts
export interface Attack {
  id: string;
  name: string;
  description: string;
  narrative: string;
  feature: string;
  defaultCount: number;
  defaultConcurrency: number;
}

export const ATTACKS: Attack[] = [
  {
    id: 'sql-injection',
    name: 'SQL Injection',
    description: 'Injeta payloads SQL no campo de busca de produtos',
    narrative: 'Um atacante tenta extrair dados da tabela de usuários via busca.',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 5,
  },
  {
    id: 'path-traversal',
    name: 'Path Traversal / Scan',
    description: 'Tenta ler arquivos fora do diretório e varre rotas comuns',
    narrative: 'Um scanner automático procura arquivos sensíveis (.env, /etc/passwd).',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 5,
  },
  {
    id: 'brute-force',
    name: 'Brute Force de Login',
    description: 'Martela /api/login com senhas comuns contra admin',
    narrative: 'Tentativa de adivinhar a senha do admin por força bruta.',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 8,
  },
  {
    id: 'exfiltracao',
    name: 'Exfiltração de Dados',
    description: 'Requisita exports cada vez maiores (padrão de exfiltração)',
    narrative: 'Saída de dados crescente simulando vazamento.',
    feature: 'ASM / Signals',
    defaultCount: 30,
    defaultConcurrency: 4,
  },
];

export function getAttack(id: string): Attack | undefined {
  return ATTACKS.find((a) => a.id === id);
}

export const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE vendas; --",
  "' UNION SELECT username, senha, 1 FROM usuarios --",
  "admin'--",
  "' OR 1=1 --",
];

export const TRAVERSAL_PATHS = [
  '../../../../etc/passwd',
  '....//....//etc/hosts',
  '/.env',
  '/admin',
  '/wp-login.php',
  '../../config',
];

export const COMMON_PASSWORDS = [
  '123456',
  'password',
  'admin',
  'root',
  'qwerty',
  'letmein',
  'senha',
  'admin123',
];
```

- [ ] **Step 4: Rodar e confirmar verde**

Run (em `api/`):
```bash
npm test -- src/attacks.test.ts
```
Expected: PASS — 3 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/attacks.ts api/src/attacks.test.ts
git commit -m "feat(api): add attack catalog with payload lists"
```

---

### Task 2: Endpoints vulneráveis-por-design (com gating)

**Files:**
- Modify: `api/src/db.ts` (adicionar `buscarUsuario`)
- Modify: `api/src/index.ts` (3 endpoints + imports)
- Modify: `docker-compose.yml` (`DEMO_VULN_ENDPOINTS=true`)

- [ ] **Step 1: Adicionar `buscarUsuario` em `db.ts`**

Em `api/src/db.ts`, antes da linha `export { pool };`, adicionar:
```ts
export async function buscarUsuario(
  username: string
): Promise<{ username: string; senha: string } | null> {
  const result = await pool.query(
    'SELECT username, senha FROM usuarios WHERE username = $1',
    [username]
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 2: Adicionar imports em `index.ts`**

Em `api/src/index.ts`, após `import path from 'path';` (linha 5), adicionar:
```ts
import fs from 'fs';
```
Alterar o import do `db` (adicionado na Etapa 1) de:
```ts
import { buscarProdutos } from './db';
```
para:
```ts
import { buscarProdutos, buscarUsuario } from './db';
```

- [ ] **Step 3: Registrar os 3 endpoints vulneráveis (antes do fallback SPA)**

Em `api/src/index.ts`, imediatamente antes do comentário `// SPA fallback`, adicionar:
```ts
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

```

- [ ] **Step 4: Habilitar a flag no compose**

No `docker-compose.yml`, no bloco `api.environment`, adicionar:
```yaml
      - DEMO_VULN_ENDPOINTS=true
```

- [ ] **Step 5: Build + e2e dos endpoints**

Run (na raiz):
```bash
docker compose up --build -d
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3003/api/login -H "Content-Type: application/json" -d '{"username":"admin","senha":"errada"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3003/api/login -H "Content-Type: application/json" -d '{"username":"admin","senha":"admin123"}'
```
Expected: primeiro `401`, segundo `200`.

- [ ] **Step 6: Commit**

```bash
git add api/src/db.ts api/src/index.ts docker-compose.yml
git commit -m "feat(api): add gated intentionally-vulnerable endpoints for ASM demo"
```

---

### Task 3: Orquestrador de ataques (`attackRunner`) com `buildAttackRequest` (TDD)

**Files:**
- Create: `api/src/attackRunner.ts`
- Test: `api/src/attackRunner.test.ts`

- [ ] **Step 1: Escrever o teste de `buildAttackRequest` (falha — módulo não existe)**

Create `api/src/attackRunner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAttackRequest } from './attackRunner';

describe('buildAttackRequest', () => {
  it('sql-injection usa GET em /api/produtos/buscar', () => {
    const r = buildAttackRequest('sql-injection', 0);
    expect(r.method).toBe('get');
    expect(r.url).toContain('/api/produtos/buscar?q=');
  });

  it('path-traversal mira /api/arquivos', () => {
    expect(buildAttackRequest('path-traversal', 0).url).toContain('/api/arquivos?path=');
  });

  it('brute-force faz POST em /api/login com admin', () => {
    const r = buildAttackRequest('brute-force', 0);
    expect(r.method).toBe('post');
    expect(r.url).toContain('/api/login');
    expect((r.data as { username: string }).username).toBe('admin');
  });

  it('exfiltracao cresce o size a cada índice', () => {
    expect(buildAttackRequest('exfiltracao', 4).url).toContain('size=500');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run (em `api/`):
```bash
npm test -- src/attackRunner.test.ts
```
Expected: FAIL — `Failed to resolve import './attackRunner'`.

- [ ] **Step 3: Implementar `attackRunner.ts`**

Create `api/src/attackRunner.ts`:
```ts
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
```

- [ ] **Step 4: Rodar e confirmar verde**

Run (em `api/`):
```bash
npm test -- src/attackRunner.test.ts
```
Expected: PASS — 4 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/attackRunner.ts api/src/attackRunner.test.ts
git commit -m "feat(api): add attack runner with self-targeted malicious requests"
```

---

### Task 4: Endpoints de orquestração de ataque + SSE

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Importar o runner de ataque**

Em `api/src/index.ts`, após o import de `./scenarios`, adicionar:
```ts
import {
  ATTACKS,
} from './attacks';
import {
  startAttack,
  stopAttack,
  registerAttackSSE,
  unregisterAttackSSE,
} from './attackRunner';
```

- [ ] **Step 2: Registrar os endpoints de ataque (antes dos endpoints vulneráveis)**

Em `api/src/index.ts`, antes do comentário `// DEMO: endpoints intencionalmente vulneráveis`,
adicionar:
```ts
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

```

- [ ] **Step 3: Build + e2e de um ataque ponta a ponta**

Run (na raiz):
```bash
docker compose up --build -d
curl -s http://localhost:3003/api/attack/list | head -c 200
curl -s -X POST http://localhost:3003/api/attack/run -H "Content-Type: application/json" -d '{"attack":"sql-injection"}'
```
Expected: a lista JSON dos 4 ataques; `{"status":"started","attack":"sql-injection"}`.

- [ ] **Step 4: Commit**

```bash
git add api/src/index.ts
git commit -m "feat(api): add attack orchestration endpoints + SSE channel"
```

---

## Definition of Done (Etapa 3)

- [ ] `npm test` em `api/` passa (incluindo `attacks.test.ts` e `attackRunner.test.ts`).
- [ ] Com `DEMO_VULN_ENDPOINTS=true`, os 4 endpoints respondem; sem a flag, retornam 404.
- [ ] `POST /api/attack/run` dispara a simulação e emite eventos no SSE `/api/attack/events`.

### Verificação no Datadog (manual)

- [ ] **Security → App and API Protection:** traces das requisições de ataque aparecem
  marcados com atividade de segurança (SQLi, scanning, brute force).
- [ ] **Security Signals:** sinais gerados para os padrões de ataque.
- [ ] **APM → Error Tracking:** falhas repetidas agrupadas em poucas issues.

> Lembrete de segurança: manter `DEMO_VULN_ENDPOINTS` desligado fora da demo; nunca publicar a porta da API em rede não confiável.
