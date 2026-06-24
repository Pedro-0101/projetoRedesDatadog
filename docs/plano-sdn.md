# Plano de Implementação: SDN + Datadog

## Visão Geral

Este documento detalha a implementação de 5 funcionalidades que simulam conceitos de
**Software Defined Networking (SDN)** com observabilidade via Datadog. A ideia central é
transformar o projeto de e-commerce em uma demonstração de como um controlador SDN toma
decisões de roteamento em tempo real — e como o Datadog captura cada uma dessas decisões.

### Arquitetura resultante

```
Browser
  └─> API (api-vendas)
        └─> SDN Controller (dentro da API)
              ├─ avalia Flow Rules   [Ideia 3]
              ├─ aplica QoS queues   [Ideia 2]
              ├─ aplica Token Bucket [Ideia 5]
              └─> roteia para worker-a / worker-b / worker-c  [Ideia 1]
                    └─> Postgres

UI de Topologia (tempo real via SSE)  [Ideia 4]
  └─ puxa estado do SDN Controller e renderiza o grafo da rede
```

### Ordem de implementação recomendada

| # | Funcionalidade               | Pré-requisito |
|---|------------------------------|---------------|
| 1 | Multi-worker + SDN Router    | nenhum        |
| 2 | QoS / Prioridade             | Ideia 1       |
| 3 | Flow Rules                   | Ideia 1       |
| 4 | Topologia em tempo real      | Ideias 1 e 3  |
| 5 | Traffic Shaping (Token Bucket)| Ideia 1      |

---

> **Atualização (closed-loop + planos):** além das 5 ideias abaixo, a demo agora separa
> explicitamente **plano de controle** (api = controlador SDN, Datadog = observa/dirige) e
> **plano de dados** (browser→api→worker→postgres) — visível na topologia (campo `plane`,
> links de controle tracejados). E fecha o ciclo: com `SDN_AUTOREMEDIATION=true` a API
> consulta os monitors `demo:sdn` via Datadog API e bloqueia/reativa workers conforme eles
> entram em Alert/OK, emitindo Datadog Events sobrepostos aos gráficos. Ver README → "Rede
> SDN: plano de controle vs plano de dados".

## Ideia 1 — SDN Router com Múltiplos Workers

### Objetivo

Subir três instâncias do worker (`worker-a`, `worker-b`, `worker-c`). Um **SDN Controller**
dentro da API monitora a saúde de cada worker e roteia cada request para o melhor disponível.
É possível bloquear rotas manualmente para simular falhas e ver o roteamento automático em ação.

### O que o Datadog vai mostrar

- Gráfico de tráfego por worker (tag `dd.worker`)
- Spike de latência em `worker-a` → queda de tráfego para ele
- Evento de rerouting como log com `sdn.route_change=true`
- Métrica `sdn.route.rerouted` subindo quando um worker degrada

### Mudanças necessárias

#### `docker-compose.yml`

Substituir o serviço `worker` único por três serviços com nomes distintos:

```yaml
worker-a:
  build: ./worker
  mem_limit: 256m
  restart: unless-stopped
  environment:
    - DD_SERVICE=worker-a
    - DD_ENV=dev
    - DD_VERSION=1.0.0
    - DD_AGENT_HOST=datadog-agent
    - DD_TRACE_SAMPLE_RATE=1
    - DD_PROFILING_ENABLED=true

worker-b:
  build: ./worker
  # igual ao worker-a, DD_SERVICE=worker-b

worker-c:
  build: ./worker
  # igual ao worker-a, DD_SERVICE=worker-c
```

Adicionar variável de ambiente na API:

```yaml
api:
  environment:
    - SDN_WORKERS=http://worker-a:8080,http://worker-b:8080,http://worker-c:8080
```

#### Novo arquivo: `api/src/sdnController.ts`

```typescript
// Estruturas de dados
interface WorkerStats {
  url: string;
  name: string;
  avgLatency: number;       // rolling average das últimas 20 requests
  errorRate: number;        // fração de erros nas últimas 20 requests
  inFlight: number;         // requests em andamento agora
  blocked: boolean;         // bloqueio manual
  recentLatencies: number[];
  recentErrors: boolean[];
}

interface RoutingDecision {
  worker: string;
  reason: 'least_latency' | 'failover' | 'round_robin' | 'forced';
  alternatives: string[];
}
```

Lógica de roteamento — função `selectWorker()`:
1. Filtra workers bloqueados e sem resposta recente
2. Calcula health score: `score = 1 - errorRate - (avgLatency / 5000)`
3. Retorna o worker com maior score
4. Fallback: round-robin se todos estiverem degradados

Função `recordResult(worker, latencyMs, success)`:
- Atualiza a janela deslizante de métricas do worker
- Envia métricas ao DogStatsD: `sdn.worker.latency`, `sdn.worker.error_rate`

#### Novos endpoints em `api/src/index.ts`

```
GET  /api/sdn/workers              → estado atual de todos os workers
POST /api/sdn/workers/:name/block  → bloqueia um worker (rota cai)
POST /api/sdn/workers/:name/unblock→ reativa o worker
GET  /api/sdn/events               → SSE com atualizações a cada 2s
```

#### Mudança em `api/src/testRunner.ts`

Substituir o `axios.post(WORKER_URL)` por `sdnController.route(payload)`, que:
1. Chama `selectWorker()` para escolher o destino
2. Faz a chamada HTTP para o worker selecionado
3. Chama `recordResult()` com o resultado

#### Métricas DogStatsD novas

| Métrica                  | Tipo      | Tags                          |
|--------------------------|-----------|-------------------------------|
| `sdn.worker.latency`     | histogram | `worker`, `env`               |
| `sdn.worker.error_rate`  | gauge     | `worker`, `env`               |
| `sdn.route.selected`     | counter   | `worker`, `reason`            |
| `sdn.route.rerouted`     | counter   | `from_worker`, `to_worker`    |
| `sdn.route.blocked`      | gauge     | `worker`                      |

#### Novos cenários de teste

| ID                         | Descrição                                                        |
|----------------------------|------------------------------------------------------------------|
| `sdn-congestion`           | Sobrecarrega worker-a com cpu-burn → controller migra tráfego   |
| `sdn-route-failure`        | Bloqueia worker-b no meio do teste → observe failover           |
| `sdn-balanced`             | 300 requests normais → deve distribuir ~33% por worker          |
| `sdn-recovery`             | Degrada worker-a, aguarda 10s, restaura → observe rebalanceamento|

---

## Ideia 2 — QoS / Prioridade de Tráfego

### Objetivo

Cada request recebe uma classe de serviço (`gold`, `silver`, `bronze`). O controlador
mantém filas separadas com concorrência máxima por classe. Sob alta carga, bronze é
throttled primeiro; gold sempre recebe capacidade garantida.

### O que o Datadog vai mostrar

- p95 latency separado por priority tag
- `bronze` com latência explodindo durante congestionamento, `gold` permanece flat
- `qos.queue.depth` subindo para `bronze` enquanto `gold` mantém profundidade zero

### Mudanças necessárias

#### Novo arquivo: `api/src/qosController.ts`

```typescript
type Priority = 'gold' | 'silver' | 'bronze';

interface QosConfig {
  maxConcurrency: Record<Priority, number>;
  maxQueueDepth: Record<Priority, number>;
}

// Valores padrão
const DEFAULT_CONFIG: QosConfig = {
  maxConcurrency: { gold: 20, silver: 10, bronze: 3 },
  maxQueueDepth:  { gold: 100, silver: 50, bronze: 20 },
};
```

Implementação com semáforos (via contadores atômicos):
- `acquire(priority)`: tenta obter um slot; se não houver, enfileira e aguarda
- `release(priority)`: libera um slot e despacha o próximo da fila
- Timeout configurável por classe (bronze tem timeout menor)

#### Como a prioridade é determinada

O campo `priority` vem no corpo do request de teste ou é definido pelo cenário:
```json
{ "scenario": "rajada-de-trafego", "priority": "bronze" }
```

Cenários novos que misturam classes:

| ID                    | Mix                                    | Concorrência total |
|-----------------------|----------------------------------------|--------------------|
| `qos-mixed-load`      | 50% gold, 30% silver, 20% bronze       | 200 req            |
| `qos-bronze-storm`    | 100% bronze, alta concorrência         | 300 req            |
| `qos-priority-proof`  | 100 gold + 200 bronze simultâneos      | 300 req            |

#### Novos endpoints

```
GET  /api/qos/stats          → profundidade atual de cada fila + slots em uso
POST /api/qos/config         → ajusta maxConcurrency/maxQueueDepth em runtime
GET  /api/qos/events         → SSE com stats a cada 1s
```

#### Métricas DogStatsD novas

| Métrica                    | Tipo      | Tags              |
|----------------------------|-----------|-------------------|
| `qos.queue.depth`          | gauge     | `priority`, `env` |
| `qos.slots.used`           | gauge     | `priority`, `env` |
| `qos.request.latency`      | histogram | `priority`, `env` |
| `qos.request.throttled`    | counter   | `priority`, `env` |
| `qos.request.dropped`      | counter   | `priority`, `env` |

#### Integração com sdnController

`sdnController.route()` recebe a prioridade e passa para o QoS antes de rotear:
```
request.priority → qosController.acquire(priority) → sdnController.selectWorker() → worker
```

---

## Ideia 3 — Flow Rules Dinâmicas

### Objetivo

Implementar um sistema de regras de fluxo parecido com OpenFlow, avaliado a cada request
pelo SDN Controller. As regras podem redirecionar, dropar, atrasar ou alterar a prioridade
dos requests com base em condições em tempo real. Regras são criadas e removidas via API.

### O que o Datadog vai mostrar

- `sdn.flow_rule.matched` por rule_id → qual regra está sendo ativada com mais frequência
- `sdn.flow_rule.redirected` quando uma regra manda tráfego de worker-a para worker-b
- Logs com `flow_rule_id` e `flow_rule_action` para cada request afetado

### Mudanças necessárias

#### Novo arquivo: `api/src/flowRules.ts`

```typescript
type FlowCondition =
  | { type: 'latency_above';    worker: string; thresholdMs: number }
  | { type: 'error_rate_above'; worker: string; threshold: number }   // 0-1
  | { type: 'tag';              key: string;    value: string }
  | { type: 'priority';         is: 'gold' | 'silver' | 'bronze' }
  | { type: 'always' };

type FlowAction =
  | { type: 'redirect';      toWorker: string }
  | { type: 'drop' }
  | { type: 'add_delay';     ms: number }
  | { type: 'set_priority';  to: 'gold' | 'silver' | 'bronze' }
  | { type: 'allow' };          // permite explicitamente (encerra avaliação)

interface FlowRule {
  id: string;
  name: string;
  priority: number;    // regras são avaliadas em ordem decrescente de prioridade
  condition: FlowCondition;
  action: FlowAction;
  enabled: boolean;
  stats: {
    matched: number;
    lastMatchedAt?: string;
  };
}
```

Função `evaluate(context, workerStats)`:
- Ordena regras habilitadas por prioridade (maior primeiro)
- Para cada regra: testa a condição contra o contexto e as stats atuais dos workers
- Retorna a primeira ação correspondente (short-circuit)
- Se nenhuma regra casar: usa roteamento padrão

**Regras pré-configuradas (exemplos que vêm carregadas no startup):**

| ID    | Nome                          | Condição                                 | Ação                           |
|-------|-------------------------------|------------------------------------------|--------------------------------|
| r001  | Desvio por latência           | worker-a latency > 800ms                 | redirect → worker-b            |
| r002  | Failover por erro             | worker-b error_rate > 0.50               | redirect → worker-c            |
| r003  | Gold sempre permitido         | priority = gold                          | allow                          |
| r004  | Drop em sobrecarga total      | worker-a, b, c todos latency > 3000ms    | drop (retorna 503)             |

#### Novos endpoints

```
GET    /api/sdn/rules           → lista todas as regras com stats
POST   /api/sdn/rules           → cria nova regra
PUT    /api/sdn/rules/:id       → atualiza (enable/disable, muda ação, muda condição)
DELETE /api/sdn/rules/:id       → remove regra
POST   /api/sdn/rules/:id/test  → testa a regra contra o estado atual sem aplicar
```

#### Métricas DogStatsD novas

| Métrica                      | Tipo    | Tags                              |
|------------------------------|---------|-----------------------------------|
| `sdn.flow_rule.matched`      | counter | `rule_id`, `rule_name`, `env`     |
| `sdn.flow_rule.redirected`   | counter | `rule_id`, `from`, `to`, `env`    |
| `sdn.flow_rule.dropped`      | counter | `rule_id`, `env`                  |
| `sdn.flow_rule.delayed`      | counter | `rule_id`, `delay_ms`, `env`      |

#### Integração com sdnController

O `sdnController.route()` fica assim:

```
1. flowRules.evaluate(context, workerStats)  → FlowAction | null
2. Se action=redirect  → usa o worker indicado pela regra
3. Se action=drop      → retorna 503 imediatamente
4. Se action=add_delay → aguarda Nms antes de rotear
5. Se action=allow     → salta demais regras e usa seleção normal
6. Se null             → seleção normal por health score
```

---

## Ideia 4 — Topologia de Rede em Tempo Real

### Objetivo

Substituir o `topology.js` estático (que só mostra `Browser → api-vendas → worker → postgres`)
por uma visualização SVG dinâmica que reflete o estado real da rede: quais workers estão
ativos, qual o volume de tráfego em cada aresta, quais rotas estão bloqueadas ou com
problemas, e quais flow rules estão sendo aplicadas.

### O que o Datadog vai mostrar

Além da topologia local, o estado do Datadog Agent como nó na UI demonstra que cada
observação (trace, métrica, log) sai da rede simulada e chega ao Datadog — fechando o ciclo.

### Layout da topologia

```
[Browser]
    │
    ▼
[API api-vendas]  ←── SSE/Polling via /api/sdn/topology
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
[worker-a]         [worker-b]         [worker-c]
    │                   │                  │
    └────────────────────────────────────┘
                        │
                        ▼
                   [PostgreSQL]
                        │
                   [Datadog Agent]
```

Cada nó tem:
- **Cor**: verde (healthy) / amarelo (degradado) / vermelho (crítico) / cinza (bloqueado)
- **Tooltip**: latência média, taxa de erro, req/s

Cada aresta tem:
- **Espessura**: proporcional ao requests/segundo atual
- **Cor vermelha**: se a rota está bloqueada ou com alta taxa de erro
- **Animação de partícula**: um ponto se movendo indica tráfego ativo

### Mudanças necessárias

#### Novo endpoint: `GET /api/sdn/topology`

```typescript
interface TopologySnapshot {
  timestamp: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  activeRules: Array<{ id: string; name: string; matchCount: number }>;
}

interface TopologyNode {
  id: string;
  label: string;
  type: 'client' | 'api' | 'worker' | 'db' | 'datadog';
  health: 'healthy' | 'degraded' | 'critical' | 'blocked' | 'unknown';
  metrics: {
    rps: number;          // requests per second (últimos 10s)
    avgLatency: number;   // ms
    errorRate: number;    // 0-1
    inFlight: number;
  };
}

interface TopologyEdge {
  from: string;
  to: string;
  rps: number;
  blocked: boolean;
  activeRuleId?: string;  // se uma flow rule está afetando este edge
}
```

#### Novo endpoint: `GET /api/sdn/topology/events` (SSE)

Envia um `TopologySnapshot` a cada 2 segundos. O frontend escuta e atualiza o SVG
sem necessidade de polling.

#### Reescrita de `api/public/topology.js`

O arquivo atual é ~30 linhas e mostra texto estático. A nova versão:

1. **Renderiza SVG** com nós posicionados em layout fixo (definido por constante)
2. **Conecta ao SSE** `/api/sdn/topology/events`
3. **Atualiza cores dos nós** com base em `health`
4. **Atualiza espessura das arestas** com base em `rps`
5. **Anima partículas** por arestas com tráfego ativo (CSS animation)
6. **Painel lateral** (div flutuante) com:
   - Flow rules ativas + contagem de matches
   - Worker stats em tabela
7. **Click em nó** → abre tooltip com métricas detalhadas

Bibliotecas: apenas SVG nativo + CSS animations — sem dependências externas.

#### Cálculo de health dos nós (em `sdnController.ts`)

```
healthy   → errorRate < 0.05 AND avgLatency < 500ms
degraded  → errorRate < 0.25 AND avgLatency < 2000ms
critical  → errorRate >= 0.25 OR avgLatency >= 2000ms
blocked   → worker.blocked = true
unknown   → sem dados nos últimos 30s
```

---

## Ideia 5 — Traffic Shaping com Token Bucket

### Objetivo

Cada worker tem um **token bucket** com capacidade e taxa de reenchimento configuráveis.
Quando um request chega e o bucket está vazio, ele é enfileirado com delay proporcional
ou rejeitado com 429. Isso permite comparar lado a lado um burst de tráfego sem shaping
(latência caótica) versus com shaping (latência previsível, throughput limitado).

### O que o Datadog vai mostrar

- Dois runs do mesmo cenário: `shaping-off` vs `shaping-on`
- Com shaping: `sdn.shaping.throttled` cresce, mas `test.latencia` p95 fica estável
- Sem shaping: latência tem spike pronunciado, nenhum throttling
- `sdn.shaping.token_level` descendo durante burst e subindo na recuperação

### Mudanças necessárias

#### Novo arquivo: `api/src/tokenBucket.ts`

```typescript
class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;  // tokens/segundo
  private lastRefill: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  // Retorna quantos ms esperar. 0 = passou direto. -1 = bucket seco (drop).
  consume(tokens = 1, allowQueue = true): number {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return 0;
    }
    if (!allowQueue) return -1;
    const waitMs = Math.ceil(((tokens - this.tokens) / this.refillRate) * 1000);
    this.tokens = 0;
    return waitMs;
  }

  level(): number {
    this.refill();
    return this.tokens / this.capacity;  // 0-1
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

#### Configuração padrão dos buckets

| Bucket       | Capacidade | Taxa de reenchimento |
|--------------|------------|----------------------|
| worker-a     | 30 tokens  | 30/s                 |
| worker-b     | 30 tokens  | 30/s                 |
| worker-c     | 30 tokens  | 30/s                 |
| global (API) | 80 tokens  | 60/s                 |

Dois buckets são verificados em sequência: global primeiro, depois o do worker destino.

#### Comportamento quando o bucket está vazio

Controlado por flag configurável:
- **Modo `shape`** (padrão): request aguarda `waitMs` antes de prosseguir (suaviza)
- **Modo `drop`**: retorna 429 imediatamente com header `Retry-After`

#### Novos endpoints

```
GET  /api/sdn/shaping              → estado atual de todos os buckets (level, capacity, rate)
POST /api/sdn/shaping/config       → ajusta capacity e rate de um bucket em runtime
POST /api/sdn/shaping/enable       → ativa o shaping global
POST /api/sdn/shaping/disable      → desativa (permite comparação antes/depois)
POST /api/sdn/shaping/reset        → recarrega todos os buckets ao máximo
```

#### Novos cenários de teste

| ID                     | Descrição                                                    |
|------------------------|--------------------------------------------------------------|
| `shaping-burst-off`    | 400 req em 5s, sem token bucket → latência caótica          |
| `shaping-burst-on`     | 400 req em 5s, com token bucket → throughput limitado mas suave |
| `shaping-recovery`     | Burst que esgota o bucket, depois tráfego normal → vê a recuperação |

#### Métricas DogStatsD novas

| Métrica                    | Tipo      | Tags                   |
|----------------------------|-----------|------------------------|
| `sdn.shaping.allowed`      | counter   | `bucket`, `env`        |
| `sdn.shaping.throttled`    | counter   | `bucket`, `env`        |
| `sdn.shaping.dropped`      | counter   | `bucket`, `env`        |
| `sdn.shaping.wait_ms`      | histogram | `bucket`, `env`        |
| `sdn.shaping.token_level`  | gauge     | `bucket`, `env`        |

#### Integração com sdnController

O `sdnController.route()` fica assim após todas as features:

```
1. flowRules.evaluate()            → pode redirecionar/dropar antes de chegar aqui
2. qosController.acquire(priority) → aguarda slot disponível por prioridade
3. tokenBucket.consume(worker)     → aguarda se bucket vazio (ou dropa se modo=drop)
4. HTTP call para o worker selecionado
5. tokenBucket.record() + qosController.release() + sdnController.recordResult()
```

---

## Dashboard Datadog — Atualizações

Adicionar ao `datadog/dashboard.json` os seguintes widgets novos:

### Seção SDN Router

- **Tráfego por worker** — timeseries `sdn.route.selected` grouped by `worker`
- **Roteamentos automáticos** — timeseries `sdn.route.rerouted` grouped by `from_worker`
- **Workers bloqueados** — gauge `sdn.route.blocked` (alerta visual se > 0)

### Seção QoS

- **Profundidade de fila por prioridade** — timeseries `qos.queue.depth` grouped by `priority`
- **Latência p95 por prioridade** — timeseries `qos.request.latency` p95 grouped by `priority`
- **Requests throttled** — timeseries `qos.request.throttled`

### Seção Flow Rules

- **Flow rules ativas — top matches** — top list `sdn.flow_rule.matched` by `rule_name`
- **Redirects por regra** — timeseries `sdn.flow_rule.redirected`
- **Drops por regra** — timeseries `sdn.flow_rule.dropped`

### Seção Traffic Shaping

- **Token level por bucket** — timeseries `sdn.shaping.token_level` grouped by `bucket`
- **Throttled vs Allowed** — stacked bar `sdn.shaping.allowed` + `sdn.shaping.throttled`
- **Wait time p95** — timeseries `sdn.shaping.wait_ms` p95

---

## Resumo de arquivos novos e modificados

### Novos arquivos

| Arquivo                           | Responsabilidade                                        |
|-----------------------------------|---------------------------------------------------------|
| `api/src/sdnController.ts`        | Roteamento entre workers, health tracking               |
| `api/src/qosController.ts`        | Filas por prioridade com semáforos                      |
| `api/src/flowRules.ts`            | Avaliação e persistência de regras de fluxo             |
| `api/src/tokenBucket.ts`          | Implementação do token bucket por worker                |

### Arquivos modificados

| Arquivo                           | O que muda                                              |
|-----------------------------------|---------------------------------------------------------|
| `docker-compose.yml`              | Worker único → worker-a, worker-b, worker-c             |
| `api/src/index.ts`                | Novos endpoints SDN (workers, rules, qos, shaping, topology) |
| `api/src/testRunner.ts`           | Usa `sdnController.route()` ao invés de `WORKER_URL` direto |
| `api/src/scenarios.ts`            | ~10 novos cenários SDN                                  |
| `api/public/topology.js`          | Reescrita: SVG dinâmico com SSE                         |
| `api/public/index.html`           | Nova aba/seção "Rede SDN" na UI                         |
| `datadog/dashboard.json`          | 10+ widgets novos                                       |

---

## Estimativa de esforço

| Ideia                            | Complexidade | Estimativa |
|----------------------------------|--------------|------------|
| 1 — Multi-worker + SDN Router    | média        | 4-6h       |
| 2 — QoS / Prioridade             | média        | 3-4h       |
| 3 — Flow Rules                   | alta         | 5-7h       |
| 4 — Topologia SVG                | alta         | 5-8h       |
| 5 — Token Bucket                 | baixa-média  | 2-3h       |
| Dashboard + cenários             | baixa        | 2-3h       |
| **Total**                        |              | **21-31h** |
