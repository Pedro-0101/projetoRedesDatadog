# Etapa 4 — Redesign da UI para apresentação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a UI em abas (Performance / Ataques / Roteiro de Incidente), adicionar um mini-mapa de topologia ao vivo, narrativa por card e um botão "Abrir no Datadog", mantendo o painel de Performance atual funcionando.

**Architecture:** Abordagem aditiva e de baixo risco: o markup de Performance existente é movido para dentro de um painel de aba (IDs preservados, `app.js` segue funcionando). Novos módulos **clássicos** e isolados (`tabs.js`, `topology.js`, `attacks.js`, `roteiro.js`) cuidam das novas abas e se comunicam por `CustomEvent` em `document` (`dd:run-start` / `dd:run-stop`). Backend ganha `/api/config` para a URL do dashboard.

**Tech Stack:** HTML + Tailwind CDN + JavaScript vanilla (scripts clássicos) + SSE.

**Pré-requisitos:** Etapas 1–3 concluídas (endpoints de cenários e ataques disponíveis).

---

### Task 1: Endpoint `/api/config` (URL do dashboard)

**Files:**
- Modify: `api/src/index.ts`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Adicionar o endpoint antes do fallback SPA**

Em `api/src/index.ts`, antes do comentário `// SPA fallback`, adicionar:
```ts
// Config exposta à UI (ex.: link para o dashboard do Datadog).
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({ dashboardUrl: process.env.DD_DASHBOARD_URL ?? '' });
});

```

- [ ] **Step 2: Declarar a variável no compose**

No `docker-compose.yml`, no bloco `api.environment`, adicionar:
```yaml
      - DD_DASHBOARD_URL=${DD_DASHBOARD_URL:-}
```

- [ ] **Step 3: Build + verificar**

Run (na raiz):
```bash
docker compose up --build -d api
curl -s http://localhost:3003/api/config
```
Expected: `{"dashboardUrl":""}` (vazio até definir a env).

- [ ] **Step 4: Commit**

```bash
git add api/src/index.ts docker-compose.yml
git commit -m "feat(api): expose /api/config with Datadog dashboard URL"
```

---

### Task 2: Reestruturar `index.html` em abas + topologia

**Files:**
- Modify: `api/public/index.html`

- [ ] **Step 1: Substituir `index.html` pela versão em abas**

Substituir todo o conteúdo de `api/public/index.html` por:
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Datadog Demo Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: { colors: {
        dd: { purple: '#632ca6', green: '#1db954', red: '#e74c3c', yellow: '#f39c12', blue: '#3498db' }
      } } }
    }
  </script>
  <style>
    body { background: #0a0a0f; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
    .scenario-card.active { border-color: #632ca6; background: #1a1025; }
    .tab-btn.active { color: #fff; border-color: #632ca6; }
    .log-entry { animation: fadeIn 0.15s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .stat-value { font-variant-numeric: tabular-nums; }
    #progress-bar { transition: width 0.3s ease; }
    .pulse-dot { animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .panel { display: none; }
    .panel.active { display: flex; }
  </style>
</head>
<body class="text-gray-100 min-h-screen font-mono text-sm">

  <!-- Header -->
  <header class="border-b border-gray-800 px-6 py-3 flex items-center gap-3 bg-black/40 sticky top-0 z-10">
    <h1 class="text-sm font-bold tracking-widest text-gray-200 uppercase">Datadog Demo Console</h1>
    <div id="topology" class="ml-4 hidden md:flex items-center gap-2 text-xs text-gray-500"></div>
    <div class="ml-auto flex items-center gap-3 text-xs text-gray-500">
      <a id="btn-datadog" href="#" target="_blank" rel="noopener"
         class="hidden bg-dd-purple/20 border border-dd-purple/40 text-purple-200 rounded px-2 py-1 hover:bg-dd-purple/40">↗ Abrir no Datadog</a>
      <span id="status-dot" class="w-2 h-2 rounded-full bg-gray-700 inline-block"></span>
      <span id="status-text">Idle</span>
    </div>
  </header>

  <!-- Tab bar -->
  <nav class="border-b border-gray-800 px-6 flex gap-1 bg-black/20">
    <button data-tab="performance" class="tab-btn active border-b-2 border-transparent px-4 py-2 text-xs uppercase tracking-widest text-gray-400">Performance</button>
    <button data-tab="ataques" class="tab-btn border-b-2 border-transparent px-4 py-2 text-xs uppercase tracking-widest text-gray-400">Ataques</button>
    <button data-tab="roteiro" class="tab-btn border-b-2 border-transparent px-4 py-2 text-xs uppercase tracking-widest text-gray-400">Roteiro</button>
  </nav>

  <!-- ===== PERFORMANCE PANEL ===== -->
  <div id="tab-performance" class="panel active" style="height: calc(100vh - 90px);">
    <aside class="w-80 border-r border-gray-800 overflow-y-auto flex flex-col bg-black/20">
      <div class="p-4 border-b border-gray-800">
        <div class="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Cenarios</div>
        <div id="scenario-cards" class="flex flex-col gap-2">
          <div class="text-xs text-gray-700 animate-pulse">Carregando...</div>
        </div>
      </div>
      <div class="p-4 flex-1 flex flex-col gap-4">
        <div class="text-xs font-bold text-gray-600 uppercase tracking-widest">Configuracao Custom</div>
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between text-xs text-gray-500"><span>Requisicoes</span><span id="val-count" class="text-gray-300 font-bold">100</span></div>
          <input type="range" id="inp-count" min="1" max="1000" value="100" class="w-full accent-purple-600" />
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between text-xs text-gray-500"><span>Taxa de Erro</span><span id="val-error" class="text-red-400 font-bold">10%</span></div>
          <input type="range" id="inp-error" min="0" max="100" value="10" class="w-full accent-red-600" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1"><label class="text-xs text-gray-500">Delay Min (ms)</label>
            <input type="number" id="inp-min-delay" value="100" min="0" max="30000" class="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs w-full text-gray-200" /></div>
          <div class="flex flex-col gap-1"><label class="text-xs text-gray-500">Delay Max (ms)</label>
            <input type="number" id="inp-max-delay" value="1000" min="0" max="30000" class="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs w-full text-gray-200" /></div>
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex justify-between text-xs text-gray-500"><span>Concorrencia</span><span id="val-concurrency" class="text-blue-400 font-bold">10</span></div>
          <input type="range" id="inp-concurrency" min="1" max="100" value="10" class="w-full accent-blue-600" />
        </div>
      </div>
      <div class="p-4 border-t border-gray-800 flex flex-col gap-2">
        <button id="btn-run" class="w-full bg-dd-purple hover:bg-purple-700 disabled:opacity-40 text-white font-bold py-2.5 px-4 rounded tracking-widest text-xs uppercase">▶ Executar Teste</button>
        <button id="btn-stop" disabled class="w-full bg-gray-800 hover:bg-red-900 disabled:opacity-40 text-gray-400 hover:text-white font-bold py-2 px-4 rounded tracking-widest text-xs uppercase">■ Parar</button>
      </div>
    </aside>
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="border-b border-gray-800 p-4 bg-black/10">
        <div class="grid grid-cols-6 gap-3">
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Enviadas</div><div id="stat-sent" class="stat-value text-xl font-bold text-gray-200">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Sucesso</div><div id="stat-success" class="stat-value text-xl font-bold text-green-400">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Erros</div><div id="stat-errors" class="stat-value text-xl font-bold text-red-400">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Em Voo</div><div id="stat-inflight" class="stat-value text-xl font-bold text-yellow-400">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Taxa OK</div><div id="stat-rate" class="stat-value text-xl font-bold text-gray-400">—</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Latencia</div><div id="stat-latency" class="stat-value text-xl font-bold text-gray-400">—</div></div>
        </div>
      </div>
      <div class="px-4 py-3 border-b border-gray-800 bg-black/10">
        <div class="flex justify-between text-xs text-gray-600 mb-1.5"><span id="progress-label">0 / 0</span><span id="progress-pct">0%</span></div>
        <div class="w-full bg-gray-900 rounded-full h-1.5"><div id="progress-bar" class="bg-dd-purple h-1.5 rounded-full" style="width:0%"></div></div>
      </div>
      <div class="flex-1 overflow-hidden flex flex-col">
        <div class="px-4 py-2 border-b border-gray-800 flex items-center justify-between bg-black/20">
          <span class="text-xs font-bold text-gray-600 uppercase tracking-widest">Live Log</span>
          <button id="btn-clear" class="text-xs text-gray-700 hover:text-gray-400">Limpar</button>
        </div>
        <div id="log-container" class="flex-1 overflow-y-auto p-3 space-y-0.5">
          <div class="text-xs text-gray-700 italic p-2">Aguardando inicio do teste...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== ATAQUES PANEL ===== -->
  <div id="tab-ataques" class="panel" style="height: calc(100vh - 90px);">
    <aside class="w-80 border-r border-gray-800 overflow-y-auto flex flex-col bg-black/20">
      <div class="p-4 border-b border-gray-800">
        <div class="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Simulacoes de Ataque</div>
        <div id="attack-cards" class="flex flex-col gap-2"><div class="text-xs text-gray-700 animate-pulse">Carregando...</div></div>
      </div>
      <div class="p-4 border-t border-gray-800 flex flex-col gap-2 mt-auto">
        <button id="btn-attack-run" class="w-full bg-dd-red hover:bg-red-700 disabled:opacity-40 text-white font-bold py-2.5 px-4 rounded tracking-widest text-xs uppercase">⚠ Disparar Ataque</button>
        <button id="btn-attack-stop" disabled class="w-full bg-gray-800 hover:bg-red-900 disabled:opacity-40 text-gray-400 hover:text-white font-bold py-2 px-4 rounded tracking-widest text-xs uppercase">■ Parar</button>
      </div>
    </aside>
    <div class="flex-1 flex flex-col overflow-hidden">
      <div class="border-b border-gray-800 p-4 bg-black/10">
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Disparadas</div><div id="atk-sent" class="stat-value text-xl font-bold text-gray-200">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Bloqueadas</div><div id="atk-blocked" class="stat-value text-xl font-bold text-green-400">0</div></div>
          <div class="bg-gray-900/60 rounded-lg p-3 border border-gray-800"><div class="text-xs text-gray-600 mb-1 uppercase">Passaram</div><div id="atk-ok" class="stat-value text-xl font-bold text-red-400">0</div></div>
        </div>
      </div>
      <div class="flex-1 overflow-hidden flex flex-col">
        <div class="px-4 py-2 border-b border-gray-800 bg-black/20"><span class="text-xs font-bold text-gray-600 uppercase tracking-widest">Attack Log</span></div>
        <div id="attack-log" class="flex-1 overflow-y-auto p-3 space-y-0.5"><div class="text-xs text-gray-700 italic p-2">Selecione um ataque e dispare...</div></div>
      </div>
    </div>
  </div>

  <!-- ===== ROTEIRO PANEL ===== -->
  <div id="tab-roteiro" class="panel flex-col" style="height: calc(100vh - 90px);">
    <div class="max-w-3xl mx-auto w-full p-6 flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <button id="btn-roteiro-start" class="bg-dd-purple hover:bg-purple-700 text-white font-bold py-2 px-4 rounded text-xs uppercase tracking-widest">▶ Iniciar Roteiro</button>
        <button id="btn-roteiro-next" disabled class="bg-gray-800 disabled:opacity-40 text-gray-300 py-2 px-4 rounded text-xs uppercase tracking-widest">Proximo ▶</button>
        <label class="flex items-center gap-2 text-xs text-gray-400 ml-2"><input type="checkbox" id="chk-auto" class="accent-purple-600" /> Auto</label>
      </div>
      <div id="roteiro-narration" class="bg-gray-900/60 border border-gray-800 rounded-lg p-5 text-gray-300 text-sm leading-relaxed min-h-[120px]">
        O roteiro encadeia cenarios e um ataque, narrando o que o Datadog detecta em cada passo.
      </div>
      <ol id="roteiro-steps" class="flex flex-col gap-2 text-xs"></ol>
    </div>
  </div>

  <script src="topology.js"></script>
  <script src="app.js"></script>
  <script src="attacks.js"></script>
  <script src="roteiro.js"></script>
  <script src="tabs.js"></script>
</body>
</html>
```

- [ ] **Step 2: Subir e confirmar que a aba Performance ainda funciona**

Run (na raiz):
```bash
docker compose up --build -d api
```
Abrir `http://localhost:3003` — a aba Performance deve carregar os cenários e executar
um teste como antes (os IDs foram preservados). As abas Ataques/Roteiro ainda estão vazias
(serão preenchidas nas próximas tasks; os arquivos JS novos ainda não existem, então o console
mostrará 404 para eles — esperado até a Task 3+).

- [ ] **Step 3: Commit**

```bash
git add api/public/index.html
git commit -m "feat(ui): restructure UI into Performance/Ataques/Roteiro tabs + topology slot"
```

---

### Task 3: Troca de abas, topologia e link do Datadog

**Files:**
- Create: `api/public/tabs.js`
- Create: `api/public/topology.js`
- Modify: `api/public/app.js` (disparar eventos de atividade)

- [ ] **Step 1: Criar `tabs.js` (troca de abas + botão Datadog)**

Create `api/public/tabs.js`:
```js
// Troca de abas
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
  });
});

// Link "Abrir no Datadog"
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg.dashboardUrl) {
      const a = document.getElementById('btn-datadog');
      a.href = cfg.dashboardUrl;
      a.classList.remove('hidden');
    }
  })
  .catch(() => {});
```

- [ ] **Step 2: Criar `topology.js` (mini-mapa ao vivo)**

Create `api/public/topology.js`:
```js
(function () {
  const el = document.getElementById('topology');
  if (!el) return;

  const node = (label, color) =>
    `<span class="px-2 py-0.5 rounded border border-gray-700 ${color}">${label}</span>`;
  const arrow = '<span class="text-gray-600">→</span>';

  let active = 0;

  function render() {
    const dot = active > 0
      ? '<span class="pulse-dot w-2 h-2 rounded-full bg-dd-green inline-block"></span>'
      : '<span class="w-2 h-2 rounded-full bg-gray-700 inline-block"></span>';
    el.innerHTML = [
      dot,
      node('Browser', 'text-gray-300'),
      arrow,
      node('api-vendas', 'text-purple-300'),
      arrow,
      node('worker', 'text-blue-300'),
      '<span class="text-gray-700">|</span>',
      node('postgres', 'text-green-300'),
    ].join(' ');
  }

  document.addEventListener('dd:run-start', () => { active++; render(); });
  document.addEventListener('dd:run-stop', () => { active = Math.max(0, active - 1); render(); });
  render();
})();
```

- [ ] **Step 3: Disparar eventos de atividade no `app.js`**

Em `api/public/app.js`, na função `setRunningState`, dentro do `if (running) { ... } else { ... }`,
adicionar as linhas indicadas:

No ramo `if (running) {` (após setar `statusText`):
```js
    document.dispatchEvent(new CustomEvent('dd:run-start'));
```
No ramo `else {` (após setar `statusText`):
```js
    document.dispatchEvent(new CustomEvent('dd:run-stop'));
```

- [ ] **Step 4: Verificar**

Recarregar `http://localhost:3003`. Trocar de abas deve funcionar; ao executar um teste, o
ponto da topologia no header pulsa em verde. Sem erros 404 no console (todos os JS existem).

- [ ] **Step 5: Commit**

```bash
git add api/public/tabs.js api/public/topology.js api/public/app.js
git commit -m "feat(ui): tab switching, live topology and Datadog link"
```

---

### Task 4: Aba de Ataques (`attacks.js`)

**Files:**
- Create: `api/public/attacks.js`

- [ ] **Step 1: Criar `attacks.js`**

Create `api/public/attacks.js`:
```js
(function () {
  const cardsEl = document.getElementById('attack-cards');
  const btnRun = document.getElementById('btn-attack-run');
  const btnStop = document.getElementById('btn-attack-stop');
  const logEl = document.getElementById('attack-log');
  const stSent = document.getElementById('atk-sent');
  const stBlocked = document.getElementById('atk-blocked');
  const stOk = document.getElementById('atk-ok');

  let selected = null;
  let es = null;

  const ICON = { 'sql-injection': '💉', 'path-traversal': '📂', 'brute-force': '🔑', 'exfiltracao': '📤' };

  fetch('/api/attack/list').then((r) => r.json()).then(render).catch(() => {
    cardsEl.innerHTML = '<div class="text-xs text-red-500">Falha ao carregar ataques</div>';
  });

  function render(attacks) {
    cardsEl.innerHTML = '';
    for (const a of attacks) {
      const card = document.createElement('button');
      card.className = 'scenario-card w-full text-left rounded-lg border border-gray-800 p-3 hover:border-red-800';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-bold text-gray-200">${ICON[a.id] || '⚠'} ${a.name}</span>
          <span class="text-xs bg-red-900/40 text-red-300 rounded px-1.5 py-0.5">${a.feature}</span>
        </div>
        <div class="text-xs text-gray-500 mb-1">${a.description}</div>
        <div class="text-xs text-gray-600 italic">${a.narrative}</div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('#attack-cards .scenario-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        selected = a.id;
      });
      cardsEl.appendChild(card);
    }
  }

  function setRunning(running) {
    btnRun.disabled = running;
    btnStop.disabled = !running;
    document.dispatchEvent(new CustomEvent(running ? 'dd:run-start' : 'dd:run-stop'));
  }

  function log(html, color) {
    const div = document.createElement('div');
    div.className = `log-entry text-xs py-0.5 ${color || 'text-gray-400'}`;
    div.innerHTML = html;
    logEl.insertBefore(div, logEl.firstChild);
    while (logEl.children.length > 500) logEl.removeChild(logEl.lastChild);
  }

  function openSSE() {
    if (es) es.close();
    es = new EventSource('/api/attack/events');
    es.addEventListener('attack-start', (e) => {
      const d = JSON.parse(e.data);
      logEl.innerHTML = '';
      stSent.textContent = stBlocked.textContent = stOk.textContent = '0';
      log(`<span class="text-purple-300">Ataque ${d.attackId} iniciado (${d.total})</span>`);
    });
    es.addEventListener('attack-result', (e) => {
      const d = JSON.parse(e.data);
      stSent.textContent = d.stats.sent;
      stBlocked.textContent = d.stats.blocked;
      stOk.textContent = d.stats.ok;
      const tag = d.blocked
        ? '<span class="text-green-400">BLOCKED 403</span>'
        : `<span class="text-red-400">${d.status}</span>`;
      log(`#${String(d.index + 1).padStart(3, '0')} ${tag} <span class="text-gray-500">${escapeHtml(d.label)}</span>`);
    });
    es.addEventListener('attack-done', (e) => {
      const d = JSON.parse(e.data);
      log(`<span class="text-purple-400">Concluido — ${d.blocked} bloqueadas / ${d.ok} passaram</span>`);
      setRunning(false);
      if (es) { es.close(); es = null; }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  btnRun.addEventListener('click', async () => {
    if (!selected) { log('<span class="text-yellow-400">Selecione um ataque primeiro</span>'); return; }
    const res = await fetch('/api/attack/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attack: selected }),
    });
    if (!res.ok) { const e = await res.json(); log(`<span class="text-red-400">ERRO: ${e.error}</span>`); return; }
    openSSE();
    setRunning(true);
  });

  btnStop.addEventListener('click', () => fetch('/api/attack/stop', { method: 'POST' }).catch(() => {}));
})();
```

- [ ] **Step 2: Verificar a aba Ataques ponta a ponta**

Recarregar a UI, ir na aba **Ataques**, selecionar **SQL Injection**, clicar **Disparar Ataque**.
Expected: o Attack Log preenche com linhas de status; os contadores Disparadas/Passaram sobem.

- [ ] **Step 3: Commit**

```bash
git add api/public/attacks.js
git commit -m "feat(ui): attacks tab with cards, stats and live attack log"
```

---

### Task 5: Aba Roteiro de Incidente (`roteiro.js`)

**Files:**
- Create: `api/public/roteiro.js`

- [ ] **Step 1: Criar `roteiro.js`**

Create `api/public/roteiro.js`:
```js
(function () {
  const STEPS = [
    { type: 'scenario', id: 'carga-normal', titulo: 'Baseline saudavel',
      narra: 'Trafego normal. No Datadog: APM verde, latencia baixa, SLO intacto.' },
    { type: 'scenario', id: 'tempestade-erros', titulo: 'Tempestade de erros',
      narra: 'Erros disparam. No Datadog: error rate sobe, Monitor alerta, error budget queima.' },
    { type: 'scenario', id: 'pico-latencia', titulo: 'Pico de latencia',
      narra: 'Requisicoes lentas. No Datadog: p95 explode, trace mostra o worker como gargalo.' },
    { type: 'attack', id: 'sql-injection', titulo: 'Ataque: SQL Injection',
      narra: 'Payloads maliciosos. No Datadog: Security Signals no ASM identificam SQLi.' },
    { type: 'scenario', id: 'carga-normal', titulo: 'Normalizacao',
      narra: 'Sistema volta ao normal. No Datadog: metricas recuperam, budget para de cair.' },
  ];

  const btnStart = document.getElementById('btn-roteiro-start');
  const btnNext = document.getElementById('btn-roteiro-next');
  const chkAuto = document.getElementById('chk-auto');
  const narration = document.getElementById('roteiro-narration');
  const stepsEl = document.getElementById('roteiro-steps');

  let idx = -1;
  let es = null;
  let busy = false;

  function renderSteps() {
    stepsEl.innerHTML = '';
    STEPS.forEach((s, i) => {
      const li = document.createElement('li');
      const state = i < idx ? 'text-green-400' : i === idx ? 'text-purple-300 font-bold' : 'text-gray-600';
      const mark = i < idx ? '✓' : i === idx ? '▶' : '•';
      li.className = `flex gap-2 ${state}`;
      li.innerHTML = `<span>${mark}</span><span>${s.titulo}</span>`;
      stepsEl.appendChild(li);
    });
  }

  function closeSSE() { if (es) { es.close(); es = null; } }

  function runStep(step) {
    busy = true;
    btnNext.disabled = true;
    narration.innerHTML = `<div class="text-purple-300 font-bold mb-1">${step.titulo}</div><div>${step.narra}</div>`;
    document.dispatchEvent(new CustomEvent('dd:run-start'));

    const runUrl = step.type === 'attack' ? '/api/attack/run' : '/api/test/run';
    const body = step.type === 'attack' ? { attack: step.id } : { scenario: step.id };
    const evtUrl = step.type === 'attack' ? '/api/attack/events' : '/api/test/events';
    const doneEvt = step.type === 'attack' ? 'attack-done' : 'done';

    fetch(runUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => {
        closeSSE();
        es = new EventSource(evtUrl);
        es.addEventListener(doneEvt, () => {
          closeSSE();
          busy = false;
          document.dispatchEvent(new CustomEvent('dd:run-stop'));
          btnNext.disabled = idx >= STEPS.length - 1;
          if (chkAuto.checked && idx < STEPS.length - 1) advance();
        });
      })
      .catch(() => { busy = false; document.dispatchEvent(new CustomEvent('dd:run-stop')); });
  }

  function advance() {
    if (busy || idx >= STEPS.length - 1) return;
    idx++;
    renderSteps();
    runStep(STEPS[idx]);
  }

  btnStart.addEventListener('click', () => {
    idx = -1;
    renderSteps();
    advance();
  });
  btnNext.addEventListener('click', advance);

  renderSteps();
})();
```

- [ ] **Step 2: Verificar o roteiro**

Recarregar a UI, ir na aba **Roteiro**, clicar **Iniciar Roteiro**. Cada passo executa um
cenário/ataque, a narração troca e a lista de passos avança. Marcar **Auto** encadeia sozinho.

- [ ] **Step 3: Commit**

```bash
git add api/public/roteiro.js
git commit -m "feat(ui): guided incident roteiro chaining scenarios and an attack"
```

---

## Definition of Done (Etapa 4)

- [ ] As 3 abas trocam corretamente; a aba Performance mantém o comportamento original.
- [ ] A topologia no header pulsa quando há teste/ataque/roteiro ativo.
- [ ] A aba Ataques dispara e mostra o Attack Log com status/bloqueios.
- [ ] O Roteiro encadeia os 5 passos (manual e em modo Auto).
- [ ] Botão "Abrir no Datadog" aparece quando `DD_DASHBOARD_URL` está definido.
