# Projeto de Observabilidade com Datadog

Demonstracao pratica de APM, Logs e Metricas customizadas usando Datadog em uma arquitetura de microsservicos rodando com Docker Compose.

---

## O que este projeto demonstra

Observabilidade e a capacidade de entender o que acontece dentro de um sistema a partir dos dados que ele produz. Este projeto cobre os tres pilares principais:

- **Traces (APM):** rastreamento de uma requisicao atraves de multiplos servicos
- **Logs:** registros estruturados correlacionados com os traces
- **Metricas:** contadores de negocio enviados via DogStatsD

---

## Arquitetura

```
Usuario
  |
  | POST /comprar
  v
+----------------+          HTTP          +-------------------+
|   API (Node)   |  -------------------> |   Worker (Go)     |
|   porta 3003   |                       |   porta 8080      |
+----------------+                       +-------------------+
       |                                         |
       | traces + logs                           | traces + logs
       |                                         |
       +-------------------+---------------------+
                           |
                           v
                +---------------------+
                |   Datadog Agent     |
                |   porta 8126 (APM)  |
                |   porta 8125 (UDP)  |
                +---------------------+
                           |
                           v
                    Datadog Cloud
                  (us5.datadoghq.com)
```

### Servicos

| Servico | Tecnologia | Responsabilidade |
|---|---|---|
| `api-vendas` | Node.js + TypeScript + Express | Recebe `POST /comprar`, emite metrica, chama Worker |
| `worker-processamento` | Go | Simula processamento com delay aleatorio, falha 20% das vezes |
| `datadog-agent` | Datadog Agent 7 (Docker) | Coleta e encaminha traces, logs e metricas para a nuvem |

---

## Como os tres pilares funcionam

### 1. APM — Rastreamento Distribuido

Quando o usuario faz `POST /comprar`, um trace e criado e atravessa os dois servicos:

```
express.request          [api-vendas]       0ms -> ~1500ms
  http.request           [api-vendas]       chamada de saida para o Worker
    http.request         [worker]           requisicao recebida pelo Worker
      worker.processar   [worker]           processamento com sleep 100-1900ms
```

Isso e possivel porque:
- O `dd-trace` no Node.js injeta automaticamente cabecalhos HTTP de propagacao (`x-datadog-trace-id`, `x-datadog-parent-id`) nas chamadas feitas pelo `axios`
- O `httptrace.NewServeMux()` no Go extrai esses cabecalhos e continua o mesmo trace
- Os dois servicos reportam seus spans para o Datadog Agent, que os une em um unico trace distribuido

O resultado visivel no Datadog e o **Flame Graph**: uma linha do tempo visual mostrando exatamente quanto tempo cada parte do sistema levou.

### 2. Logs Correlacionados

Ambos os servicos emitem logs em formato JSON estruturado. Cada log contem `dd.trace_id` e `dd.span_id`:

```json
// API (Node.js)
{
  "timestamp": "2026-06-15T13:32:20.000Z",
  "level": "info",
  "message": "Requisicao de compra recebida",
  "dd.trace_id": "6454315008901807367",
  "dd.span_id": "7992132991826121577",
  "body": { "produto": "notebook", "quantidade": 1 }
}

// Worker (Go) — mesmo trace_id, span_id filho diferente
{
  "timestamp": "2026-06-15T13:32:20.392Z",
  "level": "info",
  "message": "Iniciando processamento",
  "dd.trace_id": "6454315008901807367",
  "dd.span_id": "2899094033709954106"
}
```

O `dd.trace_id` e identico nos dois servicos para a mesma requisicao. Isso permite que no Datadog Log Explorer voce clique em um log e va diretamente para o trace correspondente (botao "View in Trace"), e vice-versa.

**Como cada servico injeta o trace_id:**

No Node.js, `dd-trace` precisa ser inicializado antes de qualquer outro modulo (arquivo `api/src/tracer.ts`). O trace ID e obtido do span ativo no momento do log:

```typescript
const span = tracer.scope().active();
const ctx = span.context();
return {
  'dd.trace_id': ctx.toTraceId(),
  'dd.span_id': ctx.toSpanId(),
};
```

No Go, o span e recuperado do contexto HTTP da requisicao:

```go
span, _ := tracer.SpanFromContext(r.Context())
entry.TraceID = fmt.Sprintf("%d", span.Context().TraceID())
entry.SpanID  = fmt.Sprintf("%d", span.Context().SpanID())
```

### 3. Metricas Customizadas (DogStatsD)

A cada requisicao recebida, a API incrementa um contador via DogStatsD:

```typescript
statsd.increment('vendas.total', 1, ['env:dev', 'service:api-vendas']);
```

O protocolo DogStatsD e UDP: o cliente envia o pacote para o Datadog Agent na porta 8125 sem esperar resposta. O Agent agrega os valores e os envia em lote para a nuvem a cada 10 segundos.

No Datadog Metrics Explorer, `vendas.total` aparece como um contador que cresce a cada `POST /comprar` bem-sucedido, com as tags `env:dev` e `service:api-vendas` para filtrar.

---

## O papel do Datadog Agent

O Agent e o intermediario local entre os servicos e a nuvem. Ele:

- Escuta traces APM na porta TCP `8126`
- Escuta metricas DogStatsD na porta UDP `8125`
- Coleta logs dos containers via socket Docker
- Agrega e comprime os dados antes de enviar para `us5.datadoghq.com`

Sem o Agent rodando, os servicos continuam funcionando normalmente — as chamadas de trace e metrica simplesmente falham silenciosamente (ou ficam em buffer). O Agent e o unico ponto que precisa da `DD_API_KEY`.

---

## Rede SDN: plano de controle vs plano de dados

A demo separa explicitamente os dois planos de uma rede SDN (na UI de topologia eles
aparecem com cores/tracejados distintos e no campo "Plano SDN" do painel de detalhes):

- **Plano de controle** — decide e observa. O nó `api-vendas` é o **controlador SDN**:
  avalia flow rules, aplica QoS e token bucket e escolhe o worker de destino. O nó
  `Datadog Agent` representa a observação que, no closed-loop, também *dirige* a rede.
- **Plano de dados** — encaminha o tráfego real das requisições: `browser → api → worker → postgres`.

> Nesta demo ambos os planos rodam no mesmo processo Node (o controlador está *dentro* da
> API). A separação é conceitual/visual, não física — isto está sinalizado na UI.

### Closed-loop: o Datadog dirige a rede (auto-remediação)

Por padrão o Datadog apenas *observa*. Com `SDN_AUTOREMEDIATION=true`, a API passa a
consultar (poll) o estado dos monitors `demo:sdn` via Datadog API e **age** sobre a rede:

```
worker degrada → métrica sdn.worker.error_rate sobe → monitor "[Demo SDN] Worker degradado"
entra em Alert → a API detecta no poll → bloqueia o worker → tráfego migra → quando o
monitor volta a OK, a API reativa o worker automaticamente.
```

Cada ação vira log (`driven_by:datadog_monitor`) e um **Datadog Event** (`tags:sdn`) que
aparece sobreposto nos gráficos SDN do dashboard. Como o Datadog Cloud não alcança
`localhost`, o mecanismo é poll do estado do monitor (não webhook). Requer `DD_API_KEY` e
`DD_APP_KEY` no ambiente da API (já incluídos no `docker-compose.yml`).

Controle em runtime: `GET/POST /api/sdn/autoremediation[/enable|/disable]`.

## Variaveis de ambiente relevantes

| Variavel | Servico | Funcao |
|---|---|---|
| `DD_API_KEY` | Agent | Autentica o envio de dados ao Datadog |
| `DD_SITE` | Agent | Define a regiao da conta (`us5.datadoghq.com`) |
| `DD_AGENT_HOST` | API, Worker | Endereco do Agent dentro da rede Docker |
| `DD_SERVICE` | API, Worker | Nome do servico que aparece no Datadog |
| `DD_ENV` | API, Worker | Ambiente (`dev`, `staging`, `prod`) |
| `DD_VERSION` | API, Worker | Versao do servico para rastrear deploys |

As tres ultimas (`DD_SERVICE`, `DD_ENV`, `DD_VERSION`) formam o **Unified Service Tagging** do Datadog: ao definir as tres, todos os traces, logs e metricas do servico ficam automaticamente vinculados pela mesma tag, permitindo filtrar tudo de um servico em qualquer tela do Datadog com um unico clique.

---

## Como rodar

```bash
# 1. Configure a API key
cp .env.example .env
# Edite .env: DD_API_KEY=<sua_chave_de_api_key>

# 2. Suba o stack
docker-compose up --build

# 3. Envie requisicoes de teste
curl -X POST http://localhost:3003/comprar \
  -H "Content-Type: application/json" \
  -d '{"produto": "notebook", "quantidade": 1}'

# 4. Pare o stack
docker-compose down
```

---

## O que observar no Datadog (us5.datadoghq.com)

| Sinal | Caminho na UI | O que procurar |
|---|---|---|
| Traces | APM > Services > `api-vendas` | Flame graph com 4 spans encadeados |
| Erros APM | APM > Traces (filtrar `status:error`) | ~20% das traces com erro no Worker |
| Logs | Logs > filtrar `service:api-vendas` | JSON com `dd.trace_id` preenchido |
| Correlacao | Abrir um log > clicar "View in Trace" | Navega direto ao trace correspondente |
| Metrica | Metrics > Explorer > `vendas.total` | Contador incrementando por requisicao |

## Provisionar Datadog (dashboard, monitors, SLO)

```bash
set -a; source .env; set +a       # carrega DD_API_KEY e DD_APP_KEY
bash scripts/datadog-setup.sh     # cria dashboard, monitors e SLO
```

Copie a Dashboard URL impressa para `DD_DASHBOARD_URL` no `.env` e reinicie a API
(`docker compose up -d api`) para o botão "Abrir no Datadog" aparecer na UI.

Roteiro de apresentação: ver [`docs/runbook-apresentacao.md`](docs/runbook-apresentacao.md).
