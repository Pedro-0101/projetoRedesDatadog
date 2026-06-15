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
