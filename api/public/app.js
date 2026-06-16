// --- State ---
let eventSource = null;
let isRunning = false;
let selectedScenario = null;
let totalRequests = 0;
let logCount = 0;
const LOG_MAX = 500;

// --- DOM refs ---
const btnRun         = document.getElementById('btn-run');
const btnStop        = document.getElementById('btn-stop');
const btnClear       = document.getElementById('btn-clear');
const logContainer   = document.getElementById('log-container');
const scenarioCards  = document.getElementById('scenario-cards');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');

const statSent       = document.getElementById('stat-sent');
const statSuccess    = document.getElementById('stat-success');
const statErrors     = document.getElementById('stat-errors');
const statInflight   = document.getElementById('stat-inflight');
const statRate       = document.getElementById('stat-rate');
const statLatency    = document.getElementById('stat-latency');

const progressBar    = document.getElementById('progress-bar');
const progressLabel  = document.getElementById('progress-label');
const progressPct    = document.getElementById('progress-pct');

const inpCount       = document.getElementById('inp-count');
const inpError       = document.getElementById('inp-error');
const inpConcurrency = document.getElementById('inp-concurrency');
const inpMinDelay    = document.getElementById('inp-min-delay');
const inpMaxDelay    = document.getElementById('inp-max-delay');
const valCount       = document.getElementById('val-count');
const valError       = document.getElementById('val-error');
const valConcurrency = document.getElementById('val-concurrency');

const qosGold      = document.getElementById('qos-gold');
const qosSilver    = document.getElementById('qos-silver');
const qosBronze    = document.getElementById('qos-bronze');
const qosThrottled = document.getElementById('qos-throttled');
const qosDropped   = document.getElementById('qos-dropped');

// --- Scenario loading ---
async function loadScenarios() {
  try {
    const res = await fetch('/api/scenarios');
    const scenarios = await res.json();
    renderScenarioCards(scenarios);
  } catch (e) {
    scenarioCards.innerHTML = '<div class="text-xs text-red-500">Falha ao carregar cenarios</div>';
  }
}

const SCENARIO_ICONS = {
  'carga-normal':      '🟢',
  'tempestade-erros':  '🔴',
  'pico-latencia':     '🟡',
  'rajada-trafego':    '⚡',
  'falha-cascata':     '🌊',
  'qos-mixed-load':    '🏅',
  'qos-bronze-storm':  '🥉',
  'qos-priority-proof':'👑',
};

function renderScenarioCards(scenarios) {
  scenarioCards.innerHTML = '';
  for (const s of scenarios) {
    const icon = SCENARIO_ICONS[s.id] || '▶';
    const card = document.createElement('button');
    card.className = 'scenario-card w-full text-left rounded-lg border border-gray-800 p-3 hover:border-purple-800 hover:bg-gray-900/50';
    card.dataset.id = s.id;

    const errPct = Math.round(s.errorRate * 100);
    const delayLabel = s.minDelay >= 1000
      ? `${(s.minDelay/1000).toFixed(1)}–${(s.maxDelay/1000).toFixed(1)}s`
      : `${s.minDelay}–${s.maxDelay}ms`;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-bold text-gray-200">${icon} ${s.name}</span>
        ${s.cascading ? '<span class="text-xs text-orange-400 font-bold">CASCADE</span>' : ''}
      </div>
      <div class="text-xs text-gray-500 mb-2">${s.description}</div>
      <div class="flex flex-wrap gap-1">
        <span class="text-xs bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">${s.count} reqs</span>
        <span class="text-xs ${errPct > 50 ? 'bg-red-900/50 text-red-400' : errPct > 0 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-green-900/50 text-green-400'} rounded px-1.5 py-0.5">${errPct}% err</span>
        <span class="text-xs bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">${delayLabel}</span>
        <span class="text-xs bg-blue-900/30 text-blue-400 rounded px-1.5 py-0.5">c${s.concurrency}</span>
      </div>
    `;
    card.addEventListener('click', () => selectScenario(s, card));
    scenarioCards.appendChild(card);
  }
}

function selectScenario(s, cardEl) {
  document.querySelectorAll('.scenario-card').forEach(b => b.classList.remove('active'));
  cardEl.classList.add('active');
  selectedScenario = s.id;

  inpCount.value = s.count;
  valCount.textContent = s.count;
  inpError.value = Math.round(s.errorRate * 100);
  valError.textContent = `${Math.round(s.errorRate * 100)}%`;
  inpMinDelay.value = s.minDelay;
  inpMaxDelay.value = s.maxDelay;
  inpConcurrency.value = s.concurrency;
  valConcurrency.textContent = s.concurrency;
}

function clearCardSelection() {
  document.querySelectorAll('.scenario-card').forEach(b => b.classList.remove('active'));
  selectedScenario = null;
}

// --- Slider sync ---
inpCount.addEventListener('input', () => {
  valCount.textContent = inpCount.value;
  clearCardSelection();
});
inpError.addEventListener('input', () => {
  valError.textContent = `${inpError.value}%`;
  clearCardSelection();
});
inpConcurrency.addEventListener('input', () => {
  valConcurrency.textContent = inpConcurrency.value;
  clearCardSelection();
});
inpMinDelay.addEventListener('input', clearCardSelection);
inpMaxDelay.addEventListener('input', clearCardSelection);

// --- Test lifecycle ---
async function runTest() {
  const body = selectedScenario
    ? { scenario: selectedScenario }
    : {
        count: parseInt(inpCount.value),
        errorRate: parseInt(inpError.value) / 100,
        minDelay: parseInt(inpMinDelay.value),
        maxDelay: parseInt(inpMaxDelay.value),
        concurrency: parseInt(inpConcurrency.value),
      };

  try {
    const res = await fetch('/api/test/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      appendLog(`ERRO: ${err.error}`, 'error');
      return;
    }

    const data = await res.json();
    totalRequests = data.params.count;
    resetStats();
    openSSE();
    setRunningState(true);
  } catch (e) {
    appendLog(`Falha ao iniciar: ${e.message}`, 'error');
  }
}

async function stopTest() {
  try {
    await fetch('/api/test/stop', { method: 'POST' });
  } catch {}
}

function openSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  eventSource = new EventSource('/api/test/events');

  eventSource.addEventListener('start', (e) => {
    const data = JSON.parse(e.data);
    totalRequests = data.total;
    appendLog(`Teste ${data.testId} iniciado — ${data.total} requisicoes [${data.scenario}]`, 'info');
  });

  eventSource.addEventListener('reconnect', (e) => {
    const data = JSON.parse(e.data);
    totalRequests = data.total;
    updateStats(data.stats, data.stats.sent, totalRequests);
    appendLog(`Reconectado ao teste ${data.testId} em andamento`, 'info');
  });

  eventSource.addEventListener('result', (e) => {
    const data = JSON.parse(e.data);
    updateStats(data.stats, data.stats.sent, totalRequests);
    const type = data.success ? 'success' : 'error';
    const statusBadge = data.success
      ? `<span class="text-green-400">${data.statusCode}</span>`
      : `<span class="text-red-400">${data.statusCode}</span>`;
    appendLogRaw(
      `#${String(data.index + 1).padStart(4, '0')}  ${statusBadge}  <span class="text-gray-400">${data.latency}ms</span>`,
      type,
      data.timestamp
    );
  });

  eventSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    const duration = (data.duration / 1000).toFixed(1);
    if (data.cancelled) {
      appendLog(`Teste cancelado — ${data.success}/${data.total} sucesso`, 'warn');
      progressBar.style.backgroundColor = '#b45309';
    } else {
      appendLog(
        `Teste concluido — ${data.success}/${data.total} sucesso | avg ${data.avgLatency}ms | ${duration}s`,
        'done'
      );
    }
    setRunningState(false);
    if (eventSource) { eventSource.close(); eventSource = null; }
  });

  eventSource.addEventListener('error', (e) => {
    if (e.target.readyState === EventSource.CLOSED) {
      if (isRunning) {
        appendLog('Conexao SSE perdida', 'error');
        setRunningState(false);
      }
    }
  });
}

// --- Stats updates ---
function updateStats(stats, sent, total) {
  statSent.textContent     = stats.sent;
  statSuccess.textContent  = stats.success;
  statErrors.textContent   = stats.errors;
  statInflight.textContent = stats.inFlight;
  statLatency.textContent  = stats.avgLatency > 0 ? `${stats.avgLatency}ms` : '—';

  const rate = stats.successRate;
  statRate.textContent = `${rate}%`;
  statRate.className = 'stat-value text-xl font-bold ' + (
    rate >= 90 ? 'text-green-400' :
    rate >= 70 ? 'text-yellow-400' :
    'text-red-400'
  );

  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  progressBar.style.width    = `${pct}%`;
  progressLabel.textContent  = `${sent} / ${total}`;
  progressPct.textContent    = `${pct}%`;
}

function resetStats() {
  [statSent, statSuccess, statErrors, statInflight].forEach(el => el.textContent = '0');
  statRate.textContent    = '—';
  statRate.className      = 'stat-value text-xl font-bold text-gray-400';
  statLatency.textContent = '—';
  progressBar.style.width = '0%';
  progressBar.style.backgroundColor = '#632ca6';
  progressLabel.textContent = `0 / ${totalRequests}`;
  progressPct.textContent   = '0%';
  logContainer.innerHTML = '';
  logCount = 0;
  qosGold.textContent     = '0/0';
  qosSilver.textContent   = '0/0';
  qosBronze.textContent   = '0/0';
  qosThrottled.textContent = '0';
  qosDropped.textContent   = '0';
}

// --- Log helpers ---
const TYPE_COLORS = {
  success: 'text-green-400',
  error:   'text-red-400',
  warn:    'text-yellow-400',
  info:    'text-blue-400',
  done:    'text-purple-400',
};

function appendLog(message, type = 'info', timestamp = null) {
  appendLogRaw(`<span>${escapeHtml(message)}</span>`, type, timestamp);
}

function appendLogRaw(innerHtml, type = 'info', timestamp = null) {
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString('pt-BR', { hour12: false })
    : new Date().toLocaleTimeString('pt-BR', { hour12: false });

  const entry = document.createElement('div');
  entry.className = `log-entry flex gap-2 text-xs py-0.5 ${TYPE_COLORS[type] ?? 'text-gray-400'}`;
  entry.innerHTML = `<span class="text-gray-700 shrink-0 select-none">${time}</span><span class="flex gap-2">${innerHtml}</span>`;

  logContainer.insertBefore(entry, logContainer.firstChild);
  logCount++;

  while (logContainer.children.length > LOG_MAX) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// --- UI state ---
function setRunningState(running) {
  isRunning = running;
  btnRun.disabled  = running;
  btnStop.disabled = !running;

  if (running) {
    statusDot.className  = 'w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse';
    statusText.textContent = 'Executando';
    connectQosSSE();
    document.dispatchEvent(new CustomEvent('dd:run-start'));
  } else {
    statusDot.className  = 'w-2 h-2 rounded-full bg-gray-700 inline-block';
    statusText.textContent = 'Idle';
    disconnectQosSSE();
    document.dispatchEvent(new CustomEvent('dd:run-stop'));
  }
}

// --- QoS SSE ---
let qosEventSource = null;

function connectQosSSE() {
  if (qosEventSource) {
    qosEventSource.close();
    qosEventSource = null;
  }

  qosEventSource = new EventSource('/api/qos/events');

  qosEventSource.addEventListener('qos', (e) => {
    const data = JSON.parse(e.data);
    updateQosStats(data);
  });

  qosEventSource.addEventListener('error', () => {
    // will auto-reconnect
  });
}

function disconnectQosSSE() {
  if (qosEventSource) {
    qosEventSource.close();
    qosEventSource = null;
  }
}

function updateQosStats(data) {
  const g = data.queues.gold;
  const s = data.queues.silver;
  const b = data.queues.bronze;
  qosGold.textContent     = `${g.slotsUsed}/${g.depth}`;
  qosSilver.textContent   = `${s.slotsUsed}/${s.depth}`;
  qosBronze.textContent   = `${b.slotsUsed}/${b.depth}`;
  qosThrottled.textContent = data.totalThrottled;
  qosDropped.textContent   = data.totalDropped;
}

// --- Wire up ---
btnRun.addEventListener('click', runTest);
btnStop.addEventListener('click', stopTest);
btnClear.addEventListener('click', () => {
  logContainer.innerHTML = '';
  logCount = 0;
});

// --- Init ---
loadScenarios();
