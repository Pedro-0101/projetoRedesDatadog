# Etapa 1 — PostgreSQL + Database Monitoring — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar PostgreSQL com persistência de vendas, habilitar Database Monitoring (DBM) no Datadog e fazer cada requisição de teste gerar um span `postgres.query` correlacionado no trace.

**Architecture:** Novo serviço `postgres` no Compose com scripts de init (schema + usuário de monitoramento DBM). A API ganha um módulo `db.ts` (pool `pg`, auto-instrumentado pelo dd-trace) e um endpoint de busca. O `testRunner` passa a inserir uma venda a cada sucesso.

**Tech Stack:** PostgreSQL 16, `pg_stat_statements`, Datadog DBM (autodiscovery via labels), `pg` (Node), dd-trace.

**Pré-requisito:** Etapa 0 concluída (vitest disponível, flags Datadog ativas).

---

### Task 1: Scripts de inicialização do banco

**Files:**
- Create: `postgres/init/01-schema.sql`
- Create: `postgres/init/02-datadog.sql`

- [ ] **Step 1: Criar o schema da aplicação com seed**

Create `postgres/init/01-schema.sql`:
```sql
CREATE TABLE produtos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  preco NUMERIC(10,2) NOT NULL
);

INSERT INTO produtos (nome, preco) VALUES
  ('Notebook Pro 15', 7999.90),
  ('Mouse Sem Fio', 129.90),
  ('Teclado Mecanico', 349.90),
  ('Monitor 27 4K', 2199.00),
  ('Webcam HD', 259.90),
  ('Headset Gamer', 499.90);

CREATE TABLE vendas (
  id SERIAL PRIMARY KEY,
  produto TEXT,
  valor NUMERIC(10,2),
  cliente TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DEMO: senha em texto plano de propósito (alvo de brute force na Etapa 3).
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL
);

INSERT INTO usuarios (username, senha) VALUES
  ('admin', 'admin123');
```

- [ ] **Step 2: Criar o setup de DBM do Datadog**

Create `postgres/init/02-datadog.sql`:
```sql
CREATE USER datadog WITH PASSWORD 'datadog_pw';
ALTER ROLE datadog INHERIT;
GRANT pg_monitor TO datadog;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO datadog;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO datadog;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE SCHEMA IF NOT EXISTS datadog;
GRANT USAGE ON SCHEMA datadog TO datadog;
GRANT USAGE ON SCHEMA public TO datadog;

CREATE OR REPLACE FUNCTION datadog.explain_statement(
   l_query TEXT,
   OUT explain JSON
)
RETURNS SETOF JSON AS
$$
DECLARE
  curs REFCURSOR;
  plan JSON;
BEGIN
   OPEN curs FOR EXECUTE pg_catalog.concat('EXPLAIN (FORMAT JSON) ', l_query);
   FETCH curs INTO plan;
   CLOSE curs;
   RETURN QUERY SELECT plan;
END;
$$
LANGUAGE 'plpgsql'
RETURNS NULL ON NULL INPUT
SECURITY DEFINER;
```

- [ ] **Step 3: Commit**

```bash
git add postgres/init/01-schema.sql postgres/init/02-datadog.sql
git commit -m "feat: add postgres init scripts (schema + Datadog DBM setup)"
```

---

### Task 2: Serviço PostgreSQL no docker-compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Adicionar o serviço `postgres`**

No `docker-compose.yml`, dentro de `services:` (antes de `api:`), adicionar:
```yaml
  postgres:
    image: postgres:16
    command:
      - "postgres"
      - "-c"
      - "shared_preload_libraries=pg_stat_statements"
      - "-c"
      - "pg_stat_statements.track=all"
      - "-c"
      - "track_activity_query_size=4096"
    environment:
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=app_pw
      - POSTGRES_DB=vendas
    volumes:
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
      - pgdata:/var/lib/postgresql/data
    labels:
      com.datadoghq.ad.check_names: '["postgres"]'
      com.datadoghq.ad.init_configs: '[{}]'
      com.datadoghq.ad.instances: '[{"dbm": true, "host": "%%host%%", "port": 5432, "username": "datadog", "password": "datadog_pw"}]'
      com.datadoghq.ad.logs: '[{"source": "postgresql", "service": "postgres-vendas"}]'
    depends_on:
      - datadog-agent
```

- [ ] **Step 2: Ligar a API ao banco**

No bloco `api.environment`, adicionar:
```yaml
      - DATABASE_URL=postgres://app:app_pw@postgres:5432/vendas
```
No bloco `api.depends_on`, adicionar `postgres` à lista existente:
```yaml
    depends_on:
      - datadog-agent
      - worker
      - postgres
```

- [ ] **Step 3: Declarar o volume nomeado**

No fim do `docker-compose.yml`, adicionar (no nível raiz, fora de `services:`):
```yaml
volumes:
  pgdata:
```

- [ ] **Step 4: Subir e verificar o banco**

Run (na raiz):
```bash
docker compose up --build -d postgres
docker compose exec postgres psql -U app -d vendas -c "SELECT count(*) FROM produtos;"
```
Expected: retorna `6`.

- [ ] **Step 5: Verificar o usuário de monitoramento DBM**

Run:
```bash
docker compose exec postgres psql -U app -d vendas -c "SELECT rolname FROM pg_roles WHERE rolname='datadog';"
```
Expected: retorna `datadog`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add postgres service with DBM autodiscovery"
```

---

### Task 3: Módulo de banco na API (`db.ts`)

**Files:**
- Modify: `api/package.json` (dependências `pg`, `@types/pg`)
- Create: `api/src/db.ts`
- Test: `api/src/db.test.ts`

- [ ] **Step 1: Instalar o driver `pg`**

Run (em `api/`):
```bash
npm install pg
npm install -D @types/pg
```
Expected: `pg` em `dependencies`, `@types/pg` em `devDependencies`.

- [ ] **Step 2: Escrever o teste da query de busca (deve falhar — módulo não existe)**

Create `api/src/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { produtoSearchQuery } from './db';

describe('produtoSearchQuery', () => {
  it('concatena o termo diretamente (vulnerável por design)', () => {
    expect(produtoSearchQuery('mouse')).toBe(
      "SELECT id, nome, preco FROM produtos WHERE nome ILIKE '%mouse%'"
    );
  });

  it('não escapa aspas — permite injeção (comportamento esperado da demo)', () => {
    expect(produtoSearchQuery("' OR '1'='1")).toContain("' OR '1'='1");
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar a falha**

Run (em `api/`):
```bash
npm test -- src/db.test.ts
```
Expected: FAIL — `Failed to resolve import './db'`.

- [ ] **Step 4: Implementar `db.ts`**

Create `api/src/db.ts`:
```ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app_pw@postgres:5432/vendas',
  max: 10,
});

export async function inserirVenda(produto: string, valor: number, cliente: string): Promise<void> {
  await pool.query(
    'INSERT INTO vendas (produto, valor, cliente) VALUES ($1, $2, $3)',
    [produto, valor, cliente]
  );
}

// DEMO: intencionalmente vulnerável a SQL injection — alvo do ataque na Etapa 3.
export function produtoSearchQuery(q: string): string {
  return `SELECT id, nome, preco FROM produtos WHERE nome ILIKE '%${q}%'`;
}

export async function buscarProdutos(q: string): Promise<unknown[]> {
  const result = await pool.query(produtoSearchQuery(q));
  return result.rows;
}

export { pool };
```

- [ ] **Step 5: Rodar o teste e confirmar verde**

Run (em `api/`):
```bash
npm test -- src/db.test.ts
```
Expected: PASS — 2 testes.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/src/db.ts api/src/db.test.ts
git commit -m "feat: add pg pool and product search (intentionally vulnerable)"
```

---

### Task 4: Persistir venda a cada sucesso de teste

**Files:**
- Modify: `api/src/testRunner.ts`

- [ ] **Step 1: Importar o helper de inserção**

Em `api/src/testRunner.ts`, após a linha `import tracer from './tracer';` (linha 3), adicionar:
```ts
import { inserirVenda } from './db';
```

- [ ] **Step 2: Inserir a venda no ramo de sucesso**

Em `api/src/testRunner.ts`, localizar o bloco (dentro de `runBatch`):
```ts
        if (success) {
          state.success++;
          statsd.increment('teste.sucessos', 1, [`scenario:${state.scenarioId}`, 'env:dev']);
        } else {
```
Substituir por:
```ts
        if (success) {
          state.success++;
          statsd.increment('teste.sucessos', 1, [`scenario:${state.scenarioId}`, 'env:dev']);
          // Gera tráfego de banco correlacionado ao trace (span postgres.query).
          inserirVenda('produto-teste', 100, `cliente-${index}`).catch(() => {});
        } else {
```

- [ ] **Step 3: Recompilar para garantir tipos corretos**

Run (em `api/`):
```bash
npm run build
```
Expected: build sem erros de TypeScript.

- [ ] **Step 4: Commit**

```bash
git add api/src/testRunner.ts
git commit -m "feat: persist a venda on each successful test request"
```

---

### Task 5: Endpoint de busca de produtos

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Importar o helper de busca**

Em `api/src/index.ts`, após a linha `import { SCENARIOS, getScenario } from './scenarios';` (linha 13), adicionar:
```ts
import { buscarProdutos } from './db';
```

- [ ] **Step 2: Registrar o endpoint antes do fallback SPA**

Em `api/src/index.ts`, imediatamente antes do comentário `// SPA fallback` (linha 175),
adicionar:
```ts
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

```

- [ ] **Step 3: Subir tudo e testar o endpoint ponta a ponta**

Run (na raiz):
```bash
docker compose up --build -d
curl "http://localhost:3003/api/produtos/buscar?q=mouse"
```
Expected: JSON com o produto `Mouse Sem Fio`.

- [ ] **Step 4: Disparar um teste e confirmar vendas no banco**

Run:
```bash
curl -X POST http://localhost:3003/api/test/run -H "Content-Type: application/json" -d '{"scenario":"carga-normal"}'
sleep 20
docker compose exec postgres psql -U app -d vendas -c "SELECT count(*) FROM vendas;"
```
Expected: contagem de vendas > 0.

- [ ] **Step 5: Commit**

```bash
git add api/src/index.ts
git commit -m "feat: add product search endpoint backed by postgres"
```

---

## Definition of Done (Etapa 1)

- [ ] `npm test` em `api/` passa (incluindo `db.test.ts`).
- [ ] `docker compose up --build` sobe `postgres` + demais serviços.
- [ ] Busca `GET /api/produtos/buscar?q=mouse` retorna dados do banco.
- [ ] Rodar um cenário popula a tabela `vendas`.

### Verificação no Datadog (manual, após dados fluírem)

- [ ] **APM → Traces:** um trace de teste contém o span `postgres.query` como filho.
- [ ] **Service Map:** aparece a aresta `api-vendas → postgres`.
- [ ] **Database Monitoring:** a instância `postgres-vendas` lista queries normalizadas
  (ex.: `INSERT INTO vendas ...`, `SELECT ... FROM produtos ...`) via `pg_stat_statements`.

> Observação: o DBM pode levar alguns minutos para popular após o primeiro tráfego.
