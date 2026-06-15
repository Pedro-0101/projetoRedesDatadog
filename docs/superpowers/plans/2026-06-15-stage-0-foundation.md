# Etapa 0 — Fundação (config Datadog + tooling de teste) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar as flags de produto do Datadog (APM full sampling, ASM, Profiler, runtime metrics, logs injection) e estabelecer o harness de testes (vitest) que as etapas seguintes usam.

**Architecture:** Mudanças de configuração em `docker-compose.yml` + variáveis de ambiente; introdução do `vitest` no projeto `api/` com um teste de fumaça sobre uma função pura já existente.

**Tech Stack:** Docker Compose, Datadog Agent 7, dd-trace (Node/Go), vitest, TypeScript.

---

### Task 1: Harness de testes na API (vitest)

**Files:**
- Modify: `api/package.json`
- Create: `api/vitest.config.ts`
- Test: `api/src/scenarios.test.ts`

- [ ] **Step 1: Instalar vitest**

Run (em `api/`):
```bash
npm install -D vitest
```
Expected: `vitest` aparece em `devDependencies` e `package-lock.json` é atualizado.

- [ ] **Step 2: Adicionar scripts de teste ao package.json**

Em `api/package.json`, dentro de `"scripts"`, adicionar:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Criar config do vitest**

Create `api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Escrever o teste de fumaça (deve passar contra código existente)**

Create `api/src/scenarios.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SCENARIOS, getScenario } from './scenarios';

describe('getScenario', () => {
  it('retorna um cenário conhecido por id', () => {
    expect(getScenario('carga-normal')?.name).toBe('Carga Normal');
  });

  it('retorna undefined para id desconhecido', () => {
    expect(getScenario('nao-existe')).toBeUndefined();
  });

  it('todos os cenários têm os campos obrigatórios', () => {
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(typeof s.count).toBe('number');
      expect(typeof s.errorRate).toBe('number');
    }
  });
});
```

- [ ] **Step 5: Rodar os testes e confirmar verde**

Run (em `api/`):
```bash
npm test
```
Expected: PASS — 3 testes em `src/scenarios.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/vitest.config.ts api/src/scenarios.test.ts
git commit -m "test: add vitest harness with scenarios smoke test"
```

---

### Task 2: Habilitar flags de produto Datadog no docker-compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Adicionar env vars ao serviço `api`**

No `docker-compose.yml`, no bloco `api.environment`, adicionar (após as linhas existentes):
```yaml
      - DD_TRACE_SAMPLE_RATE=1
      - DD_APPSEC_ENABLED=true
      - DD_LOGS_INJECTION=true
      - DD_RUNTIME_METRICS_ENABLED=true
      - DD_PROFILING_ENABLED=true
```

- [ ] **Step 2: Adicionar env vars ao serviço `worker`**

No bloco `worker.environment`, adicionar (após as linhas existentes):
```yaml
      - DD_TRACE_SAMPLE_RATE=1
      - DD_APPSEC_ENABLED=true
      - DD_PROFILING_ENABLED=true
```

- [ ] **Step 3: Subir e verificar que nada quebrou**

Run (na raiz):
```bash
docker compose up --build -d
docker compose ps
```
Expected: `api`, `worker`, `datadog-agent` com status `running`/`healthy`.

- [ ] **Step 4: Verificar logs sem erros de inicialização**

Run:
```bash
docker compose logs api --tail 20
docker compose logs worker --tail 20
```
Expected: `API iniciada na porta 3003` e `Worker iniciado na porta 8080`; sem stack traces.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: enable Datadog ASM, profiler, runtime metrics and full sampling"
```

---

### Task 3: Template de variáveis de ambiente

**Files:**
- Create: `.env.example`
- Modify: `.gitignore` (garantir que `.env` está ignorado)

- [ ] **Step 1: Criar `.env.example`**

Create `.env.example`:
```dotenv
# Datadog — copie para .env e preencha
DD_API_KEY=
# DD_APP_KEY é necessário apenas para criar dashboards/SLOs/monitors via API (Etapa 5)
DD_APP_KEY=
DD_SITE=us5.datadoghq.com
```

- [ ] **Step 2: Garantir que `.env` está no `.gitignore`**

Verificar `.gitignore`; se não houver linha `.env`, adicioná-la:
```
.env
```
Run:
```bash
grep -qxF '.env' .gitignore || echo '.env' >> .gitignore
```

- [ ] **Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "docs: add .env.example for Datadog credentials"
```

---

## Definition of Done (Etapa 0)

- [ ] `npm test` em `api/` passa (3 testes).
- [ ] `docker compose up --build` sobe os 3 serviços sem erro.
- [ ] Serviços aparecem no Datadog com `env:dev` e `version:1.0.0`.
- [ ] `.env.example` documentado; `.env` ignorado pelo git.

## Self-review notes

- Profiler do Node: com `DD_PROFILING_ENABLED=true`, o dd-trace v5 inicia o profiler
  automaticamente; se o pacote nativo de profiling não estiver disponível, ele apenas registra
  um aviso (não quebra a API). Aceitável para a demo.
