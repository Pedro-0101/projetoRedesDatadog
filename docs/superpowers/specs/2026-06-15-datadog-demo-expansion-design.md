# Expansão do Demo Datadog — Documento de Planejamento

**Data:** 2026-06-15
**Status:** Aprovado para detalhamento de implementação
**Abordagem escolhida:** A — Estender a arquitetura atual (api + worker) + PostgreSQL

---

## 1. Objetivo

Transformar o demo atual (api-vendas + worker-processamento + datadog-agent) em uma
plataforma de apresentação capaz de demonstrar, de forma didática e visualmente impactante,
o máximo de funcionalidades do Datadog em uma sessão técnica de **30–60 minutos** para
**público misto** (técnico + gerencial), usando uma **conta trial** (maximizar features
disponíveis).

Escopo aprovado:

1. Adicionar um **banco de dados** ao Docker Compose (PostgreSQL + Database Monitoring).
2. Implementar **todos os cenários de teste** (5 atuais + 5 novos).
3. Implementar **todas as simulações de ataque** (4).
4. **Redesenhar a UI** do demo para facilitar a execução durante a apresentação.

Apêndice opcional (stretch, fora do núcleo): RUM + Synthetics.

---

## 2. Contexto da apresentação

| Dimensão | Definição |
|---|---|
| Público | Misto (devs/SRE + gestão) — precisa de camada de negócio E camada técnica |
| Conta Datadog | Trial — usar o máximo de produtos disponíveis |
| Formato | Demo técnica longa (30–60 min), explorável com calma |

Implicações de design:
- Cada cenário/ataque deve ter uma **narrativa de negócio** ("as vendas caíram 40% às 14h")
  além da métrica técnica.
- A UI deve permitir disparar tudo com **poucos cliques** e contar uma história.
- Confiabilidade ao vivo > complexidade de topologia (por isso Abordagem A).

---

## 3. Arquitetura

### 3.1 Estado atual

- **api-vendas** (Node/Express/TypeScript): serve a SPA, orquestra os testes
  (`/api/test/run`, `/api/test/stop`, `/api/test/events` via SSE, `/api/scenarios`),
  endpoint legado `/comprar`. Emite métricas StatsD via `hot-shots` e traces via `dd-trace`.
- **worker-processamento** (Go): endpoint `/processar`, simula trabalho com delay + taxa de
  erro lidos de headers (`X-Error-Rate`, `X-Min-Delay`, `X-Max-Delay`). Usa `dd-trace-go`
  (`httptrace.NewServeMux`). Já possui `go-libddwaf` em `go.mod` (ASM viável).
- **datadog-agent**: APM (8126), DogStatsD (8125/udp), coleta de logs.
- **UI** (`api/public/`): SPA vanilla JS + Tailwind CDN + SSE. Sidebar de cenários +
  config custom; painel com stats, barra de progresso e live log.

### 3.2 Estado alvo

```
Browser ──► api-vendas (Node) ──► worker-processamento (Go)
               │                        │
               │                        └─► comportamentos: mem-leak, cpu-burn,
               │                            degradação, cold-start, profiler
               ├──► PostgreSQL (vendas, produtos, usuarios)
               │
               ▼
          datadog-agent
          APM 8126 · DogStatsD 8125 · Logs · DBM · ASM
```

Fluxos:
- **Teste de performance:** UI → `api /api/test/run` → loop → `worker /processar`
  (+ INSERT em Postgres por requisição) → 1 trace com spans `express` → `worker.processar`
  → `postgres.query`.
- **Simulação de ataque:** UI → `api /api/attack/run` → a API dispara requisições maliciosas
  contra os próprios endpoints vulneráveis-por-design → passam pelo middleware instrumentado
  → ASM detecta e gera Security Signals.

---

## 4. Inventário de cenários e ataques

### 4.1 Cenários de performance (todos)

| ID | Origem | Demonstra | Comportamento |
|---|---|---|---|
| `carga-normal` | existente | baseline saudável | erro baixo, latência baixa |
| `tempestade-erros` | existente | spike de erros | 80% de falha |
| `pico-latencia` | existente | latência alta | delays de 3–8s |
| `rajada-trafego` | existente | throughput alto | 500 reqs, concorrência 50 |
| `falha-cascata` | existente | erro escalando | 5%→95% progressivo |
| `memory-leak` | **novo** | Infra metrics (RSS subindo), OOM | worker acumula memória |
| `cpu-spike` | **novo** | Continuous Profiler (flame graph) | worker queima CPU |
| `degradacao-gradual` | **novo** | Watchdog / detecção de anomalia | latência cresce ao longo do teste |
| `timeout-cascata` | **novo** | propagação de falha, pool exhaustion | worker lento + timeout na API |
| `cold-start` | **novo** | warmup, diferença de latência | primeiras N reqs lentas |

### 4.2 Simulações de ataque (todas)

| ID | Alvo (endpoint vulnerável) | Demonstra |
|---|---|---|
| `sql-injection` | `GET /api/produtos/buscar?q=` (SQL cru) | ASM: SQLi, OWASP, Security Signal |
| `path-traversal` | `GET /api/arquivos?path=` (sem sanitização) | ASM: LFI / scanning |
| `brute-force` | `POST /api/login` (sem rate limit) | ASM: credential stuffing / brute force |
| `exfiltracao` | `GET /api/export?size=` (payload crescente) | ASM/Signals: padrão de exfiltração |

---

## 5. Mapeamento Funcionalidade Datadog ↔ Etapa

| Funcionalidade Datadog | Etapa que entrega |
|---|---|
| APM / Distributed Tracing | já existe (enriquecido nas Etapas 1–2) |
| Database Monitoring (DBM) | Etapa 1 |
| Correlação trace → query | Etapa 1 |
| Continuous Profiler (flame graph) | Etapa 2 |
| Infrastructure Metrics (CPU/RAM por container) | Etapa 2 |
| Runtime Metrics (Go/Node) | Etapa 2 |
| Watchdog / detecção de anomalia | Etapa 2 |
| Application Security (ASM) + Security Signals | Etapa 3 |
| Error Tracking (agrupamento) | Etapa 3 |
| Log ↔ Trace drill-down | Etapa 5 (já há `dd.trace_id` nos logs) |
| Dashboards | Etapa 5 |
| SLOs (error budget ao vivo) | Etapa 5 |
| Monitors / Alertas | Etapa 5 |
| RUM (Real User Monitoring) | Apêndice A |
| Synthetics | Apêndice A |

---

## 6. Etapas de implementação

Cada etapa é independentemente verificável e tem um *Definition of Done* (DoD). As etapas
1→5 têm dependência sequencial leve (a UI da Etapa 4 expõe o que as Etapas 1–3 criam), mas
1, 2 e 3 podem ser desenvolvidas em paralelo após a Etapa 0.

---

### Etapa 0 — Fundação (config Datadog e versionamento)

**Objetivo:** habilitar as flags de produto e padronizar tagging antes de adicionar features.

**Mudanças:**
- Criar/ajustar `.env` (não versionado) com `DD_API_KEY`, `DD_APP_KEY` (necessário p/ criar
  dashboards/SLOs via API na Etapa 5), `DD_SITE=us5.datadoghq.com`.
- `docker-compose.yml` — adicionar variáveis de ambiente nos serviços de app:
  - Comum: `DD_ENV=dev`, `DD_VERSION=1.0.0`, `DD_TRACE_SAMPLE_RATE=1` (full sampling p/ demo).
  - API (Node): `DD_APPSEC_ENABLED=true`, `DD_LOGS_INJECTION=true`,
    `DD_RUNTIME_METRICS_ENABLED=true`, `DD_PROFILING_ENABLED=true`.
  - Worker (Go): `DD_APPSEC_ENABLED=true`, `DD_PROFILING_ENABLED=true`.
- Agent: confirmar `DD_APM_ENABLED`, `DD_LOGS_ENABLED`, `DD_DOGSTATSD_NON_LOCAL_TRAFFIC`,
  `DD_APM_NON_LOCAL_TRAFFIC` (já presentes) e que o site é `us5`.

**DoD:** `docker compose up` sobe sem erro; os serviços aparecem no Datadog com `env:dev`,
`version:1.0.0`; nenhuma feature quebrada.

---

### Etapa 1 — PostgreSQL + Database Monitoring

**Objetivo:** adicionar persistência real e mostrar DBM + correlação trace→query.

**Novos arquivos:**
- `postgres/init/01-schema.sql` — schema da aplicação:
  - `produtos(id, nome, preco)` — com seed de dados (alvo de busca/SQLi).
  - `vendas(id, produto, valor, cliente, criado_em)` — escrita pelos testes.
  - `usuarios(id, username, senha_hash)` — seed com `admin` (alvo de brute force).
- `postgres/init/02-datadog.sql` — setup DBM padrão Datadog:
  - `CREATE USER datadog WITH PASSWORD 'datadog_pw';`
  - `GRANT pg_monitor TO datadog;`
  - extensão `pg_stat_statements`; schema `datadog` + função `explain_statement` (script
    oficial DBM do Datadog).

**docker-compose.yml — novo serviço:**
```yaml
postgres:
  image: postgres:16
  command:
    - "postgres"
    - "-c"
    - "shared_preload_libraries=pg_stat_statements"
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
```
- `api` ganha `depends_on: [postgres]` e env `DATABASE_URL=postgres://app:app_pw@postgres:5432/vendas`.
- Volume nomeado `pgdata`.

**Mudanças na API:**
- Adicionar dependência `pg` (auto-instrumentada pelo `dd-trace`).
- `api/src/db.ts` — pool de conexões + helpers (`inserirVenda`, `buscarProdutos`,
  `buscarUsuario`).
- No fluxo de teste (`testRunner.ts`): após o `worker /processar` retornar sucesso, fazer
  `INSERT INTO vendas`. Isso gera o span `postgres.query` filho dentro do trace.
- Endpoint `GET /api/produtos/buscar?q=` (busca legítima; vira alvo de SQLi na Etapa 3).

**Critérios de verificação (Datadog):**
- Service Map mostra `api-vendas → postgres`.
- Um trace de teste contém span `postgres.query`.
- Página **Database Monitoring** lista queries normalizadas via `pg_stat_statements`.

**DoD:** vendas persistidas; DBM populando; trace com 3 níveis (express → worker → postgres).

---

### Etapa 2 — Novos cenários de performance + Continuous Profiler

**Objetivo:** habilitar 5 cenários novos e o Profiler, demonstrando Infra metrics, flame
graphs e detecção de anomalia.

**Mudanças no worker (Go):**
- Novos comportamentos lidos de headers (seguindo o padrão atual):
  - `X-Mem-Leak-KB` → anexa N KB a um slice de pacote nunca liberado (RSS sobe).
  - `X-Cpu-Burn-Ms` → busy-loop (hash) por N ms (aparece no Profiler).
  - `X-Degrade: 1` → adiciona latência incremental por um contador global (degradação).
  - `X-Cold-Reset: N` / endpoint `/cold` → marca N próximas requisições como "frias" (lentas).
- Endpoint `POST /reset` — zera estado global (mem leak, contador de degradação, cold) entre
  execuções da demo. **Importante p/ repetibilidade ao vivo.**
- Iniciar o **Continuous Profiler**: `profiler.Start(profiler.WithProfileTypes(CPU, Heap,
  Goroutine, Mutex))` no `main.go` + `defer profiler.Stop()`.
- Habilitar Runtime Metrics no tracer (`tracer.WithRuntimeMetrics()`).
- Limite de memória no container do worker (`mem_limit`) para o `memory-leak` causar OOM
  controlado e visível, sem derrubar a máquina host.

**Mudanças na API:**
- `scenarios.ts` — adicionar campo opcional `behavior?: 'mem-leak' | 'cpu-burn' | 'degrade'
  | 'cold-start'` e as 5 definições novas:

| ID | count | erro | delays | conc. | behavior |
|---|---|---|---|---|---|
| `memory-leak` | 200 | 0 | 50–150ms | 10 | mem-leak (~512KB/req) |
| `cpu-spike` | 100 | 0 | 50–100ms | 8 | cpu-burn (200ms/req) |
| `degradacao-gradual` | 200 | 0.02 | 100–300ms | 5 | degrade |
| `timeout-cascata` | 100 | 0 | 2000–5000ms | 20 | (timeout API 2500ms) |
| `cold-start` | 50 | 0 | 100–300ms | 5 | cold-start (15 frias) |
- `testRunner.ts` — repassar os headers correspondentes ao `behavior`; para `timeout-cascata`,
  configurar `timeout` curto no axios para gerar timeouts em cascata.

**Critérios de verificação (Datadog):**
- `cpu-spike`: flame graph do Profiler mostra a função de burn dominando a CPU.
- `memory-leak`: métrica de container (RSS) sobe monotonicamente; OOM visível.
- `degradacao-gradual`: distribuição de latência no APM cresce; Watchdog pode sinalizar.
- `timeout-cascata`: erros de timeout no APM; `inFlight` empilha na UI.

**DoD:** 5 cenários disparáveis; Profiler com dados; `/reset` restaura baseline.

---

### Etapa 3 — Simulações de ataque + Application Security (ASM)

**Objetivo:** gerar Security Signals reais no Datadog ASM a partir das 4 simulações.

> ⚠️ **Segurança:** os endpoints abaixo são **propositalmente vulneráveis, só para a demo**.
> Ficam atrás da flag `DEMO_VULN_ENDPOINTS=true` (desligados por padrão), restritos à rede
> Docker local. **Nunca expor publicamente.** Documentar isso em destaque no README.

**Habilitar ASM:** `DD_APPSEC_ENABLED=true` na API e no worker (Etapa 0 já adiciona).

**Endpoints vulneráveis-por-design na API** (comentados `// DEMO: intencionalmente vulnerável`):
- `GET /api/produtos/buscar?q=` — `SELECT ... WHERE nome LIKE '%${q}%'` (SQL cru) → SQLi.
- `GET /api/arquivos?path=` — `fs.readFile(join(base, path))` sem sanitização → path traversal.
- `POST /api/login` — compara credenciais contra `usuarios`, sem rate limit → brute force.
- `GET /api/export?size=` — retorna JSON de tamanho crescente → padrão de exfiltração.

**Novos arquivos:**
- `api/src/attacks.ts` — catálogo de ataques (metadados + listas de payloads):
  - `sql-injection`: `' OR '1'='1`, `'; DROP TABLE vendas; --`, `UNION SELECT ...`, etc.
  - `path-traversal`: `../../etc/passwd`, `....//....//etc/hosts`, `/admin`, `/.env`,
    `/wp-login.php`, etc.
  - `brute-force`: lista de senhas comuns contra `admin`.
  - `exfiltracao`: tamanhos crescentes em `/api/export`.
- `api/src/attackRunner.ts` — espelha a estrutura do `testRunner` (semáforo, estado, broadcast
  SSE), mas dispara requisições maliciosas contra os endpoints próprios da API.

**Novos endpoints de orquestração:**
- `GET /api/attack/list` — catálogo com metadados (nome, descrição, sinal ASM esperado).
- `POST /api/attack/run` — inicia uma simulação (`{ attack, count, concurrency }`).
- `POST /api/attack/stop`.
- Eventos via SSE (`/api/attack/events`, ou reaproveitar a infra de broadcast existente com
  `kind: 'attack'`).
- Métrica `ataque.requisicoes` taggeada por tipo de ataque.

**Critérios de verificação (Datadog):**
- **Security → App and API Protection**: traces marcados com atividade de segurança.
- Security Signals gerados (SQLi, scanning, brute force).
- Error Tracking agrupa as falhas repetidas em poucas issues.

**DoD:** 4 ataques disparáveis pela API; sinais aparecendo no ASM; flag de gating funcionando.

---

### Etapa 4 — Redesign da UI para apresentação

**Objetivo:** tornar a execução de cenários e ataques fluida e narrativa durante a demo.

**Estrutura em abas** (tab bar no header):
1. **Performance** — cards de cenários (agrupados: saudável / falhas / recursos) + config
   custom + painel de monitoramento atual.
2. **Segurança / Ataques** — cards de ataque (SQLi, traversal, brute force, exfil), cada um
   com descrição, badge do sinal ASM esperado, botões run/stop, e log com estilo de "ameaça".
3. **Modo Apresentação (Roteiro de Incidente)** — sequência guiada e auto-encadeada:
   `carga-normal` (baseline) → injeta `tempestade-erros` → `pico-latencia` →
   `sql-injection` → normaliza. Com painel de narração on-screen ("Agora o Datadog
   detecta…") e toggle Próximo/Automático. Reaproveita os endpoints de run existentes.

**Componentes novos:**
- **Mini-mapa de topologia**: Browser → API → Worker / API → Postgres, com pulso quando há
  tráfego e cor de saúde (verde/vermelho) derivada da taxa de sucesso atual.
- **Narrativa por card**: cada cenário/ataque ganha uma linha de "problema de negócio" e um
  **badge de feature** (APM / DBM / Profiler / ASM / SLO).
- **Botão "Abrir no Datadog"** + QR code opcional, apontando para o dashboard (URL via
  `/api/config`). Permite a plateia acompanhar pelo celular.

**Backend de apoio à UI:**
- `/api/scenarios` passa a incluir `behavior`, `narrative`, `feature`.
- `/api/attack/list` (Etapa 3) inclui `narrative`, `feature`.
- `/api/config` retorna a URL do dashboard Datadog (injetada por env).

**Refatoração da UI** (alinhada ao princípio de arquivos focados): dividir `app.js` em ES
modules (`<script type="module">`, sem bundler) — `app.js` (bootstrap + abas),
`performance.js`, `attacks.js`, `roteiro.js`, `topology.js`, compartilhando `sse.js` + `ui.js`.

**DoD:** 3 abas funcionais; roteiro encadeado roda sozinho; topologia reflete o tráfego;
disparar qualquer cenário/ataque leva ≤ 2 cliques.

---

### Etapa 5 — Dashboards, SLOs, Monitors + Runbook

**Objetivo:** garantir que o que é gerado apareça de forma legível no Datadog e dar ao
apresentador um roteiro.

**Entregáveis (config Datadog como código + instruções):**
- `datadog/dashboard-demo.json` — dashboard importável: throughput (sucesso/erro), latência
  p50/p95/p99 por serviço, Service Map embed, top queries (DBM), contagem de Security Signals,
  link p/ Profiler.
- `datadog/slos.json` — SLOs:
  - Disponibilidade: taxa de erro < 5%.
  - Latência: 95% das requisições < 500ms.
- `datadog/monitors.json` — Monitors: error rate alto (> 20%), p95 alto, Security Signal,
  conexões/slow query no Postgres.
- `scripts/datadog-setup.sh` — cria dashboard/SLOs/monitors via API (`DD_API_KEY` +
  `DD_APP_KEY`); inclui também instruções de import manual.
- `docs/runbook-apresentacao.md` — roteiro de 30–60 min: ordem da demo, o que falar em cada
  etapa, onde clicar (incl. drill-down **log↔trace** e **error budget queimando ao vivo**).

**DoD:** dashboard, SLOs e monitors importáveis; runbook cobre a sessão inteira.

---

## 7. Apêndice A — RUM + Synthetics (opcional / stretch)

- **RUM:** adicionar o Datadog Browser SDK ao `index.html` (applicationId/clientToken de um
  app RUM criado no Datadog) com `allowedTracingUrls` apontando para a API → correlaciona
  sessões de frontend com traces de backend.
- **Synthetics:** teste de API batendo em `/health` a cada 1 min + teste de browser da UI;
  alerta ao "matar" o serviço durante a demo (detecção antes do usuário reclamar).

Tratar como bônus: só implementar após o núcleo (Etapas 1–5) estar estável.

---

## 8. Riscos e considerações

- **Limites do trial:** confirmar que **DBM, ASM e Profiler** estão habilitados na conta
  trial antes da demo (alguns produtos podem exigir ativação).
- **Segurança dos endpoints vulneráveis:** gating por `DEMO_VULN_ENDPOINTS`, nunca expor
  publicamente, não publicar a porta do Postgres no host.
- **Confiabilidade ao vivo:** `memory-leak` pode causar OOM — usar `mem_limit` no worker e o
  endpoint `/reset` para limpar estado entre execuções.
- **Volume de dados:** `DD_TRACE_SAMPLE_RATE=1` aumenta o volume; aceitável para demo curta.
- **Repetibilidade:** todo estado global do worker (leak, degradação, cold) deve ser
  resetável via `/reset` para a demo poder rodar várias vezes.

---

## 9. Checklist de preparação da apresentação

- [ ] `.env` com `DD_API_KEY` + `DD_APP_KEY`.
- [ ] Verificar DBM / ASM / Profiler habilitados no trial.
- [ ] Importar dashboard, SLOs e monitors (Etapa 5).
- [ ] (Opcional) Criar app RUM + testes Synthetics (Apêndice A).
- [ ] Smoke test de cada cenário e cada ataque uma vez antes de apresentar.
- [ ] Rodar `/reset` no worker para começar do baseline.

---

## 10. Ordem de execução recomendada

```
Etapa 0 (fundação)
   ├─► Etapa 1 (Postgres + DBM)      ┐
   ├─► Etapa 2 (cenários + Profiler) ├─ podem ser paralelas
   └─► Etapa 3 (ataques + ASM)       ┘
            └─► Etapa 4 (UI) ──► Etapa 5 (dashboards/SLOs/runbook)
                                        └─► Apêndice A (RUM/Synthetics, opcional)
```
