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
