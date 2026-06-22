/*
 * topology/settings.js — PAINEL DE CONFIGURACOES (estilo Obsidian)
 * ---------------------------------------------------------------
 * Controles ao vivo para fisica, aparencia, pacotes e filtros. Mexe diretamente
 * nos modulos (Topo.physics / Topo.renderer / Topo.packets / Topo.data) e
 * delega ao `main` o que precisa de estado global (pausar, recentralizar).
 */
(function () {
  const TYPES = [
    ['client', 'Clientes'], ['api', 'API'], ['worker', 'Workers'],
    ['db', 'Banco'], ['datadog', 'Datadog'],
  ];

  let toggleBtn, panel, paused = false, handlers = {};
  const typeEnabled = { client: true, api: true, worker: true, db: true, datadog: true };
  let hideBlocked = false;

  function slider(label, min, max, step, value, fmt, oninput) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:8px;';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;';
    const l = document.createElement('span'); l.textContent = label;
    const val = document.createElement('span'); val.style.color = '#e5e7eb'; val.textContent = fmt(value);
    top.appendChild(l); top.appendChild(val);
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    inp.className = 'w-full accent-purple-600';
    inp.oninput = () => { const x = parseFloat(inp.value); val.textContent = fmt(x); oninput(x); };
    wrap.appendChild(top); wrap.appendChild(inp);
    return wrap;
  }

  function checkbox(label, checked, onchange) {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#9ca3af;cursor:pointer;margin:3px 0;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = checked; cb.className = 'accent-purple-600';
    cb.onchange = () => onchange(cb.checked);
    lab.appendChild(cb); lab.appendChild(document.createTextNode(label));
    return lab;
  }

  function heading(text) {
    const h = document.createElement('div');
    h.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin:12px 0 6px;';
    h.textContent = text;
    return h;
  }

  function button(text, onclick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'flex:1;background:#1f2937;border:1px solid #374151;color:#d1d5db;border-radius:5px;' +
      'padding:6px;font-size:11px;cursor:pointer;';
    b.onmouseenter = () => (b.style.background = '#374151');
    b.onmouseleave = () => (b.style.background = '#1f2937');
    b.onclick = onclick;
    return b;
  }

  function applyFilter() {
    Topo.renderer.setFilter((nodeData) =>
      typeEnabled[nodeData.type] !== false && (!hideBlocked || nodeData.health !== 'blocked'));
  }

  function init(container, h) {
    handlers = h || {};

    toggleBtn = document.createElement('button');
    toggleBtn.textContent = '⚙';
    toggleBtn.title = 'Configurações';
    toggleBtn.style.cssText =
      'position:absolute;top:12px;left:12px;z-index:40;width:34px;height:34px;border-radius:8px;' +
      'background:rgba(20,20,30,0.9);border:1px solid #374151;color:#d1d5db;font-size:16px;cursor:pointer;';
    toggleBtn.onclick = () => {
      const open = panel.style.transform === 'translateX(0px)' || panel.style.transform === 'translateX(0)';
      panel.style.transform = open ? 'translateX(-110%)' : 'translateX(0)';
    };
    container.appendChild(toggleBtn);

    panel = document.createElement('div');
    panel.style.cssText =
      'position:absolute;top:56px;left:12px;width:240px;max-height:calc(100% - 72px);overflow-y:auto;z-index:40;' +
      'background:rgba(14,14,22,0.96);border:1px solid #1f2937;border-radius:10px;padding:12px;' +
      'transform:translateX(-110%);transition:transform .2s ease;box-shadow:0 8px 24px rgba(0,0,0,0.5);';

    // ---- Física ----
    panel.appendChild(heading('Física'));
    const P = Topo.physics.getParams();
    panel.appendChild(slider('Center force', 0, 0.4, 0.01, P.centerStrength, (x) => x.toFixed(2),
      (x) => Topo.physics.setParam('centerStrength', x)));
    panel.appendChild(slider('Repel force', 0, 1000, 10, -P.repelStrength, (x) => String(Math.round(x)),
      (x) => Topo.physics.setParam('repelStrength', -x)));
    panel.appendChild(slider('Link force', 0, 1, 0.05, P.linkStrength, (x) => x.toFixed(2),
      (x) => Topo.physics.setParam('linkStrength', x)));
    panel.appendChild(slider('Link distance', 20, 260, 5, P.linkDistance, (x) => String(Math.round(x)),
      (x) => Topo.physics.setParam('linkDistance', x)));

    // ---- Aparência ----
    panel.appendChild(heading('Aparência'));
    panel.appendChild(slider('Tamanho dos nós', 0.5, 2.5, 0.1, 1, (x) => x.toFixed(1) + 'x',
      (x) => Topo.renderer.setAppearance({ nodeSize: x })));
    panel.appendChild(slider('Espessura das arestas', 0.5, 3, 0.1, 1, (x) => x.toFixed(1) + 'x',
      (x) => Topo.renderer.setAppearance({ edgeWidth: x })));
    panel.appendChild(checkbox('Mostrar rótulos', true,
      (c) => Topo.renderer.setAppearance({ showLabels: c })));

    // ---- Pacotes ----
    panel.appendChild(heading('Pacotes'));
    panel.appendChild(checkbox('Animar tráfego', true, (c) => Topo.packets.setConfig({ enabled: c })));
    panel.appendChild(slider('Velocidade', 0.2, 3, 0.1, 1, (x) => x.toFixed(1) + 'x',
      (x) => Topo.packets.setConfig({ speed: x })));
    panel.appendChild(slider('Densidade', 0.2, 3, 0.1, 1, (x) => x.toFixed(1) + 'x',
      (x) => Topo.packets.setConfig({ density: x })));

    // ---- Filtros ----
    panel.appendChild(heading('Filtros'));
    for (const [t, label] of TYPES) {
      panel.appendChild(checkbox(label, true, (c) => { typeEnabled[t] = c; applyFilter(); }));
    }
    panel.appendChild(checkbox('Ocultar bloqueados', false, (c) => { hideBlocked = c; applyFilter(); }));

    // ---- Fonte de dados ----
    panel.appendChild(heading('Fonte de dados'));
    panel.appendChild(checkbox('Modo mock (demo)', false, (c) => Topo.data.setMock(c)));

    // ---- Ações ----
    panel.appendChild(heading('Simulação'));
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;';
    actions.appendChild(button('↺ Recentralizar', () => { Topo.physics.unfixAll(); handlers.onReset && handlers.onReset(); }));
    const pauseBtn = button('⏸ Pausar', () => {
      paused = !paused;
      if (paused) { Topo.physics.pause(); pauseBtn.textContent = '▶ Retomar'; }
      else { Topo.physics.resume(); pauseBtn.textContent = '⏸ Pausar'; }
      handlers.onPauseToggle && handlers.onPauseToggle(paused);
    });
    actions.appendChild(pauseBtn);
    panel.appendChild(actions);

    container.appendChild(panel);
  }

  window.Topo = window.Topo || {};
  window.Topo.settings = { init };
})();
