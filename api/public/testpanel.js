/*
 * testpanel.js — PAINEL LATERAL DE TESTES (gerador de trafego real)
 * -----------------------------------------------------------------
 * Dispara requisicoes HTTP reais pelo backend (/api/test/run), que percorrem
 * api -> workers -> postgres. Esse trafego real aparece como pacotes se movendo
 * no mapa SDN. O foco aqui e simular pacotes reais com controles simples;
 * cenarios elaborados podem ser montados depois sobre essa base.
 *
 * Acompanha o progresso via SSE (/api/test/events) e mostra stats + log ao vivo.
 */
(function () {
  // --- Estado ---
  let eventSource = null;
  let isRunning = false;
  let selectedScenario = null;
  let totalRequests = 0;
  const LOG_MAX = 500;

  // --- Refs ---
  const $ = (id) => document.getElementById(id);
  const panel        = $('test-panel');
  const btnToggle    = $('tp-toggle');
  const btnRun       = $('tp-run');
  const btnStop      = $('tp-stop');
  const scenariosEl  = $('tp-scenarios');
  const statusDot    = $('status-dot');
  const statusText   = $('status-text');

  const statSent     = $('tp-sent');
  const statSuccess  = $('tp-success');
  const statErrors   = $('tp-errors');
  const statInflight = $('tp-inflight');
  const statRate     = $('tp-rate');
  const statLatency  = $('tp-latency');
  const progressBar  = $('tp-progress-bar');
  const progressLbl  = $('tp-progress-label');
  const progressPct  = $('tp-progress-pct');

  const inpCount     = $('tp-count');
  const inpError     = $('tp-error');
  const inpConc      = $('tp-concurrency');
  const inpMinDelay  = $('tp-min-delay');
  const inpMaxDelay  = $('tp-max-delay');
  const valCount     = $('tp-count-val');
  const valError     = $('tp-error-val');
  const valConc      = $('tp-conc-val');

  // Modo de roteamento
  const routeBtns    = Array.from(document.querySelectorAll('.route-mode-btn'));
  const routeHint    = $('tp-routing-hint');

  // Drawer de logs
  const logsDrawer   = $('logs-drawer');
  const logsToggle   = $('tp-logs-toggle');
  const logsClose    = $('logs-close');
  const logsClear    = $('logs-clear');
  const logsContainer = $('logs-container');

  // --- Painel colapsavel ---
  btnToggle.addEventListener('click', () => panel.classList.toggle('collapsed'));

  // --- Presets (cenarios reais do backend) ---
  async function loadScenarios() {
    try {
      const res = await fetch('/api/scenarios');
      const scenarios = await res.json();
      renderScenarios(scenarios);
    } catch {
      scenariosEl.innerHTML = '<div class="text-xs text-red-500">Falha ao carregar presets</div>';
    }
  }

  function renderScenarios(scenarios) {
    scenariosEl.innerHTML = '';
    for (const s of scenarios) {
      const chip = document.createElement('button');
      chip.className = 'chip text-xs border border-gray-700 rounded px-2 py-1 text-gray-400 hover:border-purple-700';
      chip.textContent = s.name;
      chip.title = s.description || '';
      chip.dataset.id = s.id;
      chip.addEventListener('click', () => selectScenario(s, chip));
      scenariosEl.appendChild(chip);
    }
  }

  function selectScenario(s, chipEl) {
    document.querySelectorAll('#tp-scenarios .chip').forEach((c) => c.classList.remove('active'));
    chipEl.classList.add('active');
    selectedScenario = s.id;
    inpCount.value = s.count;        valCount.textContent = s.count;
    inpError.value = Math.round(s.errorRate * 100); valError.textContent = `${Math.round(s.errorRate * 100)}%`;
    inpConc.value = s.concurrency;   valConc.textContent = s.concurrency;
    inpMinDelay.value = s.minDelay;
    inpMaxDelay.value = s.maxDelay;
  }

  function clearScenario() {
    document.querySelectorAll('#tp-scenarios .chip').forEach((c) => c.classList.remove('active'));
    selectedScenario = null;
  }

  // --- Sync sliders ---
  inpCount.addEventListener('input', () => { valCount.textContent = inpCount.value; clearScenario(); });
  inpError.addEventListener('input', () => { valError.textContent = `${inpError.value}%`; clearScenario(); });
  inpConc.addEventListener('input', () => { valConc.textContent = inpConc.value; clearScenario(); });
  inpMinDelay.addEventListener('input', clearScenario);
  inpMaxDelay.addEventListener('input', clearScenario);

  // --- Ciclo de vida do teste ---
  async function runTest() {
    const body = selectedScenario
      ? { scenario: selectedScenario }
      : {
          count: parseInt(inpCount.value, 10),
          errorRate: parseInt(inpError.value, 10) / 100,
          minDelay: parseInt(inpMinDelay.value, 10),
          maxDelay: parseInt(inpMaxDelay.value, 10),
          concurrency: parseInt(inpConc.value, 10),
        };
    try {
      const res = await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        appendLog(`ERRO: ${err.error || res.status}`, 'error');
        return;
      }
      const data = await res.json();
      totalRequests = data.params.count;
      resetStats();
      openSSE();
      setRunning(true);
    } catch (e) {
      appendLog(`Falha ao iniciar: ${e.message}`, 'error');
    }
  }

  async function stopTest() {
    try { await fetch('/api/test/stop', { method: 'POST' }); } catch {}
  }

  function openSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    eventSource = new EventSource('/api/test/events');

    eventSource.addEventListener('start', (e) => {
      const d = JSON.parse(e.data);
      totalRequests = d.total;
      appendLog(`Teste ${d.testId} iniciado — ${d.total} requisições [${d.scenario}]`, 'info');
    });
    eventSource.addEventListener('reconnect', (e) => {
      const d = JSON.parse(e.data);
      totalRequests = d.total;
      updateStats(d.stats, d.stats.sent, totalRequests);
      appendLog(`Reconectado ao teste ${d.testId} em andamento`, 'info');
      setRunning(true);
    });
    eventSource.addEventListener('result', (e) => {
      const d = JSON.parse(e.data);
      updateStats(d.stats, d.stats.sent, totalRequests);
      const badge = d.success
        ? `<span class="text-green-400">${d.statusCode}</span>`
        : `<span class="text-red-400">${d.statusCode}</span>`;
      appendLogRaw(
        `#${String(d.index + 1).padStart(4, '0')}  ${badge}  <span class="text-gray-400">${d.latency}ms</span>`,
        d.success ? 'success' : 'error',
        d.timestamp
      );
    });
    eventSource.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      const dur = (d.duration / 1000).toFixed(1);
      if (d.cancelled) {
        appendLog(`Teste cancelado — ${d.success}/${d.total} sucesso`, 'warn');
        progressBar.style.backgroundColor = '#b45309';
      } else {
        appendLog(`Teste concluído — ${d.success}/${d.total} sucesso | avg ${d.avgLatency}ms | ${dur}s`, 'done');
      }
      setRunning(false);
      if (eventSource) { eventSource.close(); eventSource = null; }
    });
    eventSource.addEventListener('error', (e) => {
      if (e.target.readyState === EventSource.CLOSED && isRunning) {
        appendLog('Conexão SSE perdida', 'error');
        setRunning(false);
      }
    });
  }

  // --- Stats ---
  function updateStats(stats, sent, total) {
    statSent.textContent     = stats.sent;
    statSuccess.textContent  = stats.success;
    statErrors.textContent   = stats.errors;
    statInflight.textContent = stats.inFlight;
    statLatency.textContent  = stats.avgLatency > 0 ? `${stats.avgLatency}ms` : '—';

    const rate = stats.successRate;
    statRate.textContent = `${rate}%`;
    statRate.className = 'stat-value text-base font-bold ' +
      (rate >= 90 ? 'text-green-400' : rate >= 70 ? 'text-yellow-400' : 'text-red-400');

    const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
    progressBar.style.width = `${pct}%`;
    progressLbl.textContent = `${sent} / ${total}`;
    progressPct.textContent = `${pct}%`;
  }

  function resetStats() {
    [statSent, statSuccess, statErrors, statInflight].forEach((el) => (el.textContent = '0'));
    statRate.textContent = '—';
    statRate.className = 'stat-value text-base font-bold text-gray-400';
    statLatency.textContent = '—';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '#632ca6';
    progressLbl.textContent = `0 / ${totalRequests}`;
    progressPct.textContent = '0%';
    logsContainer.innerHTML = '';
  }

  // --- Log ---
  const TYPE_COLORS = {
    success: 'text-green-400', error: 'text-red-400', warn: 'text-yellow-400',
    info: 'text-blue-400', done: 'text-purple-400',
  };
  function appendLog(msg, type = 'info', ts = null) {
    appendLogRaw(`<span>${escapeHtml(msg)}</span>`, type, ts);
  }
  function appendLogRaw(html, type = 'info', ts = null) {
    const time = new Date(ts || Date.now()).toLocaleTimeString('pt-BR', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `log-entry flex gap-2 text-xs py-0.5 ${TYPE_COLORS[type] || 'text-gray-400'}`;
    entry.innerHTML = `<span class="text-gray-700 shrink-0 select-none">${time}</span><span class="flex gap-2">${html}</span>`;
    logsContainer.insertBefore(entry, logsContainer.firstChild);
    while (logsContainer.children.length > LOG_MAX) logsContainer.removeChild(logsContainer.lastChild);
  }
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- UI state ---
  function setRunning(running) {
    isRunning = running;
    btnRun.disabled = running;
    btnStop.disabled = !running;
    if (running) {
      statusDot.className = 'w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse';
      statusText.textContent = 'Executando';
    } else {
      statusDot.className = 'w-2 h-2 rounded-full bg-gray-700 inline-block';
      statusText.textContent = 'Idle';
    }
  }

  // --- Drawer de logs ---
  logsToggle.addEventListener('click', () => logsDrawer.classList.toggle('open'));
  logsClose.addEventListener('click', () => logsDrawer.classList.remove('open'));
  logsClear.addEventListener('click', () => { logsContainer.innerHTML = ''; });

  // --- Modo de roteamento ---
  function paintRoutingMode(mode) {
    routeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (routeHint) routeHint.textContent = mode === 'round-robin' ? 'igualitário' : 'por saúde';
  }
  async function loadRoutingMode() {
    try {
      const r = await fetch('/api/sdn/routing-mode');
      const d = await r.json();
      paintRoutingMode(d.mode);
    } catch {}
  }
  async function setRoutingMode(mode) {
    paintRoutingMode(mode); // otimista
    try {
      const r = await fetch('/api/sdn/routing-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json();
      paintRoutingMode(d.mode);
      appendLog(`Modo de roteamento: ${d.mode}`, 'info');
    } catch (e) {
      appendLog(`Falha ao mudar roteamento: ${e.message}`, 'error');
    }
  }
  routeBtns.forEach((b) => b.addEventListener('click', () => setRoutingMode(b.dataset.mode)));

  // --- Wire up ---
  btnRun.addEventListener('click', runTest);
  btnStop.addEventListener('click', stopTest);

  // Link "Abrir no Datadog"
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    if (cfg.dashboardUrl) {
      const a = $('btn-datadog');
      a.href = cfg.dashboardUrl;
      a.classList.remove('hidden');
    }
  }).catch(() => {});

  loadScenarios();
  loadRoutingMode();
})();
