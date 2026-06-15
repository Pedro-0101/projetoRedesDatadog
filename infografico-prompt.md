# Prompt para Infografico — Observabilidade com Datadog

Use este prompt no Canva (Magic Design), Figma, ou passe para um designer.
Para geradores de imagem por IA (DALL-E, Midjourney), use a versao resumida no final.

---

## Prompt Completo (Canva / Designer)

### Formato e estilo

- Formato horizontal (landscape), proporcao 16:9, resolucao alta
- Estilo: moderno, minimalista, tecnico — similar a documentacao de arquitetura de software
- Paleta de cores:
  - Fundo: cinza escuro quase preto `#1a1a2e`
  - API Node.js: verde `#00d4aa`
  - Worker Go: azul `#4b9eff`
  - Datadog Agent: roxo `#632ca6` (cor oficial do Datadog)
  - Nuvem Datadog: laranja `#ff6b00` (cor oficial do Datadog)
  - Setas e conexoes: branco com 60% de opacidade
  - Texto principal: branco `#ffffff`
  - Texto secundario: cinza claro `#aaaaaa`
- Fonte: Inter, Roboto ou qualquer sans-serif moderna

---

### Layout geral

Dividir o infografico em duas zonas horizontais:

**Zona superior (70% da altura):** Fluxo principal da requisicao — da esquerda para a direita, 4 blocos conectados por setas

**Zona inferior (30% da altura):** Os tres pilares de observabilidade lado a lado

---

### Zona superior — Fluxo da requisicao

Titulo no topo, centralizado:
> **"Como uma requisicao e rastreada em microsservicos com Datadog"**

Subtitulo menor abaixo:
> Trace distribuido + Logs correlacionados + Metricas customizadas

---

**Bloco 1 — Usuario (extrema esquerda)**

- Icone de pessoa ou cursor de mouse
- Label: `Usuario`
- Seta saindo para a direita com texto sobre ela: `POST /comprar`

---

**Bloco 2 — API (Node.js)**

- Retangulo arredondado com borda e fundo semi-transparente na cor verde `#00d4aa`
- Header do bloco: icone do Node.js + texto `API — Node.js / TypeScript`
- Porta: `localhost:3000`
- Tres itens internos em lista com icones pequenos:

  1. Icone de etiqueta + texto:
     `Cria o Trace ID`
     sublabel: `identificador unico da requisicao`

  2. Icone de grafico de barras + texto:
     `Metrica: vendas.total +1`
     sublabel: `enviado via UDP para o Agent`

  3. Icone de documento + texto:
     `Log JSON com dd.trace_id`
     sublabel: `{"level":"info", "dd.trace_id":"6454..."}`

- Seta saindo para a direita com texto sobre ela:
  `HTTP + headers de trace`
  sublabel menor: `x-datadog-trace-id propagado automaticamente`

---

**Bloco 3 — Worker (Go)**

- Retangulo arredondado com borda e fundo semi-transparente na cor azul `#4b9eff`
- Header do bloco: icone do Go (gopher ou letra G) + texto `Worker — Go`
- Porta: `interno:8080`
- Tres itens internos em lista com icones pequenos:

  1. Icone de relogio + texto:
     `Extrai o Trace ID dos headers`
     sublabel: `continua o mesmo trace, nao cria um novo`

  2. Icone de raio + texto:
     `Processamento: 100ms a 1900ms`
     sublabel: `sleep aleatorio gera flame graph variado`

  3. Icone de dado ou porcentagem + texto:
     `20% de chance de erro proposital`
     sublabel: `{"level":"error", "dd.trace_id":"6454..."}`

- Seta saindo para baixo e para a direita em direcao ao Agent

---

**Bloco 4 — Datadog Agent**

- Retangulo arredondado com borda roxa `#632ca6`, levemente maior que os anteriores
- Header: logo do Datadog (cachorro) + texto `Datadog Agent`
- Dois itens internos:

  1. Icone de antena + texto:
     `Porta 8126 TCP — APM (Traces)`

  2. Icone de onda + texto:
     `Porta 8125 UDP — DogStatsD (Metricas)`

- Seta grossa saindo para a direita com texto:
  `HTTPS comprimido`
  sublabel: `envia em lote a cada 10 segundos`

---

**Bloco 5 — Datadog Cloud (extrema direita)**

- Forma de nuvem ou retangulo com cantos muito arredondados
- Cor laranja `#ff6b00`
- Texto interno:
  `Datadog Cloud`
  sublabel: `us5.datadoghq.com`
- Tres icones pequenos abaixo: grafico de linha (APM), lista (Logs), termometro (Metrics)

---

### Destaque visual de trace distribuido

Sobre os blocos 2, 3 e 4, desenhar uma linha horizontal pontilhada colorida (degrade de verde para azul para roxo) com o texto ao lado:

> `Mesmo dd.trace_id atravessa API e Worker`

Essa linha deve visualmente conectar os tres blocos de cima indicando que os dados pertencem ao mesmo trace.

---

### Zona inferior — Os tres pilares

Tres caixas lado a lado, cada uma com uma cor e icone proprios:

**Caixa 1 — APM / Traces**
- Cor de destaque: verde
- Icone: forma de flame graph (barras horizontais em cascata)
- Titulo: `APM — Rastreamento Distribuido`
- Texto: `Visualiza o caminho completo de uma requisicao em forma de Flame Graph. Mostra quanto tempo cada servico levou e onde ocorreram erros.`
- Exemplo visual mini: representacao simplificada de flame graph com 3 barras encaixadas

**Caixa 2 — Logs**
- Cor de destaque: amarelo `#f5a623`
- Icone: folha de papel com linhas
- Titulo: `Logs Correlacionados`
- Texto: `Cada log contem dd.trace_id. No Datadog, um clique em qualquer log abre o trace exato daquela requisicao — sem precisar procurar.`
- Exemplo visual mini: duas linhas de JSON mostrando o campo dd.trace_id destacado

**Caixa 3 — Metricas**
- Cor de destaque: azul
- Icone: grafico de barras ou contador
- Titulo: `Metricas Customizadas (DogStatsD)`
- Texto: `vendas.total e incrementado a cada compra via UDP. O Agent agrega os valores e envia para o Datadog onde vira um grafico de serie temporal.`
- Exemplo visual mini: grafico de linha subindo com label "vendas.total"

---

### Rodape

Linha fina separadora e texto pequeno centralizado:
`Node.js dd-trace v5 | Go dd-trace-go v1.65 | Datadog Agent 7 | Docker Compose`

---

## Versao resumida para gerador de imagem por IA (DALL-E / Midjourney)

```
Technical architecture infographic, dark background (#1a1a2e), horizontal layout.
Title: "Distributed Observability with Datadog".
Left to right flow with 5 connected blocks and arrows:
1. User icon sending "POST /comprar"
2. Green rounded box "API Node.js" containing: trace creation, DogStatsD metric, JSON log
3. Blue rounded box "Go Worker" containing: trace continuation, random sleep 100-1900ms, 20% error rate
4. Purple rounded box "Datadog Agent" with ports 8126 TCP and 8125 UDP
5. Orange cloud shape "Datadog Cloud us5.datadoghq.com"
A dotted colored line connects boxes 2-3-4 labeled "same dd.trace_id".
Bottom section: three side-by-side panels labeled "APM Flame Graph", "Correlated Logs", "Custom Metrics DogStatsD".
Clean, minimal, tech documentation style. White text, no gradients, flat design.
```
