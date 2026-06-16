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
