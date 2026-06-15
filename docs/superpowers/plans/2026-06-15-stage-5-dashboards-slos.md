# Etapa 5 — Dashboards, SLOs, Monitors + Runbook — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar dashboard, monitors e SLO como código (JSON + script via API do Datadog) e um runbook de apresentação, garantindo que tudo que a demo gera apareça legível no Datadog.

**Architecture:** Arquivos JSON em `datadog/` criados via API REST do Datadog (`api.us5.datadoghq.com`) por um script `scripts/datadog-setup.sh` (curl puro, sem dependências). As métricas usadas são as custom já emitidas (`teste.sucessos`, `teste.erros`, `test.latencia`, `ataque.requisicoes`), garantindo que existam.

**Tech Stack:** Datadog API v1 (dashboard, monitor, slo), curl, bash.

**Pré-requisitos:** Etapas 1–4 concluídas (métricas fluindo); `.env` com `DD_API_KEY` e `DD_APP_KEY`.

---

### Task 1: Definições como código (dashboard, monitors, SLO)

**Files:**
- Create: `datadog/dashboard.json`
- Create: `datadog/monitor-error-rate.json`
- Create: `datadog/monitor-latency.json`
- Create: `datadog/monitor-security.json`
- Create: `datadog/slo-availability.json`

- [ ] **Step 1: Criar o dashboard**

Create `datadog/dashboard.json`:
```json
{
  "title": "Demo Datadog — Visao Geral",
  "description": "Dashboard da demo (cenarios de performance + ataques).",
  "layout_type": "ordered",
  "widgets": [
    {
      "definition": {
        "type": "timeseries",
        "title": "Requisicoes: sucesso vs erro",
        "requests": [
          { "q": "sum:teste.sucessos{*}.as_count()", "display_type": "bars", "style": { "palette": "green" } },
          { "q": "sum:teste.erros{*}.as_count()", "display_type": "bars", "style": { "palette": "warm" } }
        ]
      }
    },
    {
      "definition": {
        "type": "timeseries",
        "title": "Latencia p95 (ms)",
        "requests": [ { "q": "avg:test.latencia.95percentile{*}", "display_type": "line" } ]
      }
    },
    {
      "definition": {
        "type": "query_value",
        "title": "Taxa de erro (%)",
        "precision": 1,
        "requests": [
          {
            "formulas": [ { "formula": "a / (a + b) * 100" } ],
            "queries": [
              { "name": "a", "data_source": "metrics", "query": "sum:teste.erros{*}.as_count()" },
              { "name": "b", "data_source": "metrics", "query": "sum:teste.sucessos{*}.as_count()" }
            ],
            "response_format": "scalar"
          }
        ]
      }
    },
    {
      "definition": {
        "type": "timeseries",
        "title": "Ataques por tipo",
        "requests": [ { "q": "sum:ataque.requisicoes{*} by {attack}.as_count()", "display_type": "bars" } ]
      }
    }
  ]
}
```

- [ ] **Step 2: Criar o monitor de taxa de erro**

Create `datadog/monitor-error-rate.json`:
```json
{
  "name": "[Demo] Taxa de erros alta",
  "type": "metric alert",
  "query": "sum(last_5m):sum:teste.erros{*}.as_count() > 50",
  "message": "Muitos erros no processamento de vendas durante a demo.",
  "tags": ["env:dev", "demo:datadog"],
  "options": { "thresholds": { "critical": 50, "warning": 25 }, "notify_no_data": false }
}
```

- [ ] **Step 3: Criar o monitor de latência**

Create `datadog/monitor-latency.json`:
```json
{
  "name": "[Demo] Latencia p95 alta",
  "type": "metric alert",
  "query": "avg(last_5m):avg:test.latencia.95percentile{*} > 2000",
  "message": "Latencia p95 acima de 2s durante a demo.",
  "tags": ["env:dev", "demo:datadog"],
  "options": { "thresholds": { "critical": 2000, "warning": 1000 }, "notify_no_data": false }
}
```

- [ ] **Step 4: Criar o monitor de segurança**

Create `datadog/monitor-security.json`:
```json
{
  "name": "[Demo] Atividade de ataque detectada",
  "type": "metric alert",
  "query": "sum(last_5m):sum:ataque.requisicoes{*}.as_count() > 0",
  "message": "Requisicoes de ataque detectadas (simulacao ASM).",
  "tags": ["env:dev", "demo:datadog", "security"],
  "options": { "thresholds": { "critical": 0 }, "notify_no_data": false }
}
```

- [ ] **Step 5: Criar o SLO de disponibilidade**

Create `datadog/slo-availability.json`:
```json
{
  "type": "metric",
  "name": "[Demo] Disponibilidade do processamento",
  "description": "Taxa de sucesso do processamento de vendas durante a demo.",
  "query": {
    "numerator": "sum:teste.sucessos{*}.as_count()",
    "denominator": "sum:teste.sucessos{*}.as_count() + sum:teste.erros{*}.as_count()"
  },
  "thresholds": [ { "timeframe": "7d", "target": 95.0, "warning": 99.0 } ],
  "tags": ["env:dev", "demo:datadog"]
}
```

- [ ] **Step 6: Commit**

```bash
git add datadog/
git commit -m "feat(datadog): add dashboard, monitors and SLO as code"
```

---

### Task 2: Script de provisionamento via API

**Files:**
- Create: `scripts/datadog-setup.sh`

- [ ] **Step 1: Criar o script**

Create `scripts/datadog-setup.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DD_API_KEY:?defina DD_API_KEY (export ou .env)}"
: "${DD_APP_KEY:?defina DD_APP_KEY (export ou .env)}"
SITE="${DD_SITE:-us5.datadoghq.com}"
BASE="https://api.${SITE}"
hdr=(-H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" -H "Content-Type: application/json")

echo "==> Criando dashboard..."
curl -sS -X POST "${BASE}/api/v1/dashboard" "${hdr[@]}" -d @datadog/dashboard.json \
  | sed -n 's/.*"url":"\([^"]*\)".*/    Dashboard URL: https:\/\/'"${SITE}"'\1/p'

for m in error-rate latency security; do
  echo "==> Criando monitor ${m}..."
  curl -sS -X POST "${BASE}/api/v1/monitor" "${hdr[@]}" -d @datadog/monitor-${m}.json \
    -o /dev/null -w "    HTTP %{http_code}\n"
done

echo "==> Criando SLO de disponibilidade..."
curl -sS -X POST "${BASE}/api/v1/slo" "${hdr[@]}" -d @datadog/slo-availability.json \
  -o /dev/null -w "    HTTP %{http_code}\n"

echo "==> Concluido. Copie a Dashboard URL acima para DD_DASHBOARD_URL no .env."
```

- [ ] **Step 2: Executar (a partir da raiz, com `.env` carregado)**

Run (na raiz, com as chaves exportadas):
```bash
set -a; source .env; set +a
bash scripts/datadog-setup.sh
```
Expected: imprime a Dashboard URL e `HTTP 200` para cada monitor e para o SLO.

- [ ] **Step 3: Verificar no Datadog**

- Dashboards → "Demo Datadog — Visao Geral" existe.
- Monitors → os 3 monitors `[Demo]` existem.
- Service Mgmt → SLOs → "[Demo] Disponibilidade do processamento" existe.

> Alternativa manual: em Dashboards → New Dashboard → Import dashboard JSON, colar
> `datadog/dashboard.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/datadog-setup.sh
git commit -m "feat(datadog): add API provisioning script for dashboard/monitors/SLO"
```

---

### Task 3: Runbook do apresentador

**Files:**
- Create: `docs/runbook-apresentacao.md`

- [ ] **Step 1: Criar o runbook**

Create `docs/runbook-apresentacao.md`:
```markdown
# Runbook — Apresentação Datadog (30–60 min)

## Antes de começar
1. `set -a; source .env; set +a` e `docker compose up --build -d`.
2. `bash scripts/datadog-setup.sh` (uma vez) e definir `DD_DASHBOARD_URL` no `.env`.
3. Abrir a UI em http://localhost:3003 e o dashboard no Datadog.
4. Confirmar no trial: APM, DBM, ASM e Profiler habilitados.
5. Smoke test: rodar `carga-normal` e um ataque `sql-injection` uma vez.

## Roteiro sugerido

### 1. Abertura (5 min) — visão de negócio
- Mostrar o dashboard "Demo Datadog — Visao Geral".
- Narrativa: "Somos um e-commerce. Vamos observar a saúde das vendas em tempo real."

### 2. Baseline (5 min) — APM + Service Map
- UI → Performance → `carga-normal`.
- Datadog → APM → Service Map: mostrar `api-vendas → worker → postgres`.
- Abrir um trace e mostrar os 3 spans (express → worker.processar → postgres.query).

### 3. Banco de dados (5 min) — DBM
- Datadog → Database Monitoring: mostrar queries normalizadas e o explain plan.

### 4. Incidente de erros (8 min) — Monitors + SLO
- UI → `tempestade-erros`.
- Mostrar o Monitor "[Demo] Taxa de erros alta" disparar.
- Mostrar o SLO e o error budget sendo consumido ao vivo.

### 5. Performance e recursos (10 min) — Profiler + Infra
- UI → `cpu-spike`: Datadog → Profiling → flame graph com `burnCPU`.
- UI → `memory-leak`: Infra/Containers → RSS do worker subindo até OOM.
- UI → `degradacao-gradual`: APM → latência crescente; Watchdog.

### 6. Correlação log ↔ trace (5 min)
- Em um trace com erro, clicar "View Logs": cair no log exato com `dd.trace_id`.

### 7. Segurança (10 min) — ASM
- UI → Ataques → `sql-injection`, depois `brute-force`.
- Datadog → Security → App and API Protection: Security Signals dos ataques.

### 8. Encerramento (5 min) — Modo Roteiro
- UI → Roteiro → "Iniciar Roteiro" em modo Auto: encadeia tudo enquanto você narra.

## Dicas
- Use `POST /reset` (automático no início de cada teste) para repetir cenários do baseline.
- Se o worker reiniciar por OOM (esperado no memory-leak), aguarde ~5s e siga.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook-apresentacao.md
git commit -m "docs: add presenter runbook for the Datadog demo"
```

---

### Task 4: Atualizar README e wiring do link do dashboard

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Adicionar `DD_DASHBOARD_URL` ao `.env.example`**

Em `.env.example`, adicionar ao final:
```dotenv
# URL do dashboard criado por scripts/datadog-setup.sh (aparece como botão na UI)
DD_DASHBOARD_URL=
```

- [ ] **Step 2: Documentar no README**

Em `README.md`, adicionar uma seção ao final:
```markdown
## Provisionar Datadog (dashboard, monitors, SLO)

```bash
set -a; source .env; set +a       # carrega DD_API_KEY e DD_APP_KEY
bash scripts/datadog-setup.sh     # cria dashboard, monitors e SLO
```

Copie a Dashboard URL impressa para `DD_DASHBOARD_URL` no `.env` e reinicie a API
(`docker compose up -d api`) para o botão "Abrir no Datadog" aparecer na UI.

Roteiro de apresentação: ver [`docs/runbook-apresentacao.md`](docs/runbook-apresentacao.md).
```

- [ ] **Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document Datadog provisioning and dashboard link"
```

---

## Definition of Done (Etapa 5)

- [ ] `scripts/datadog-setup.sh` cria dashboard, 3 monitors e 1 SLO (HTTP 200).
- [ ] Dashboard renderiza com dados após rodar cenários/ataques.
- [ ] Monitors disparam nos cenários correspondentes.
- [ ] SLO mostra error budget consumindo durante `tempestade-erros`.
- [ ] Runbook cobre a sessão inteira (30–60 min).
- [ ] Botão "Abrir no Datadog" funciona quando `DD_DASHBOARD_URL` está setado.
```
