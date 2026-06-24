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

### 8. Closed-loop SDN (8 min) — Datadog dirige a rede
- Garantir `SDN_AUTOREMEDIATION=true` no `.env` e `docker compose up -d api`.
- Mostrar a topologia: explicar plano de controle (api/Datadog, tracejado) vs plano de dados.
- UI → degradar um worker (cenário que sobe `sdn.worker.error_rate > 0.5`, ex.: `sdn-route-failure`).
- Datadog → Monitors: "[Demo SDN] Worker degradado" entra em **Alert** para aquele worker.
- Em ~15s a API bloqueia o worker sozinho: na topologia ele fica **blocked** e o tráfego migra.
- Dashboard SDN: ver o **Event** "Auto-remediacao: ... bloqueado pelo Datadog" sobreposto ao gráfico.
- Restaurar o worker → monitor volta a OK → a API o reativa automaticamente.

#### 8b. Reroute dirigido pelo Datadog (demo "1 worker ruim") — passo a passo
Objetivo: tráfego **igualitário** nos 3 workers até o Datadog perceber **um** worker
com muitos erros e migrar a rota — sem a heurística local roubar a cena.

1. **Pré-requisito**: `SDN_AUTOREMEDIATION=true` (a API faz poll dos monitors `demo:sdn` a cada 15s).
2. No painel de testes, em **Modo de roteamento**, selecione **Round-robin**
   (distribui igual e *mantém* o tráfego no worker ruim até o Datadog bloqueá-lo;
   no modo Health-score a própria API já desviaria antes, escondendo o efeito do Datadog).
3. No mapa, **clique no nó `worker-a`** → bloco **Injeção de falha** → deixe ~80% e
   **⚠ Injetar falha**. (Equivale a `POST /api/sdn/workers/worker-a/fault {"errorRate":0.8}`.)
   A falha é intrínseca do worker e **persiste** entre testes (o `/reset` do batch não a apaga).
4. Rode o preset **SDN Datadog Reroute** (tráfego balanceado e prolongado, ~2–3 min).
   Observe na topologia os 3 workers recebendo tráfego igual; só `worker-a` com erros/aresta anômala.
5. Datadog: `sdn.worker.error_rate{worker:worker-a}` cruza 0.5 → monitor **"[Demo SDN] Worker degradado"** entra em **Alert** só para worker-a (lag típico de ingestão+avaliação: ~1–2 min).
6. No próximo poll a API **bloqueia worker-a sozinha**: na topologia ele fica **blocked**,
   o tráfego migra 100% para worker-b/c, e sai o **Datadog Event** "Auto-remediacao: worker-a bloqueado pelo Datadog" sobreposto ao gráfico.
7. **Encerrar**: clique em worker-a → **✓ Limpar falha**. O monitor volta a OK e a API
   reativa worker-a automaticamente. Volte o **Modo de roteamento** para **Health-score**.

### 9. Encerramento (5 min) — Modo Roteiro
- UI → Roteiro → "Iniciar Roteiro" em modo Auto: encadeia tudo enquanto você narra.

## Dicas
- Use `POST /reset` (automático no início de cada teste) para repetir cenários do baseline.
- Se o worker reiniciar por OOM (esperado no memory-leak), aguarde ~5s e siga.
