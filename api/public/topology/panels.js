/*
 * topology/panels.js — PAINEL DE INFORMACOES (clique em no / aresta)
 * -----------------------------------------------------------------
 * Painel lateral que mostra detalhes ao clicar em um NO ou em uma ARESTA.
 * Atualiza dinamicamente quando chega um novo snapshot (via `refresh`) e fecha
 * ao clicar fora ou no X.
 *
 * >>> CAMPOS DO PAINEL <<< vem direto do modelo de dados (Topo.data). Campos
 * sem valor aparecem como "—" (placeholder). Para exibir novos campos, edite
 * `renderNode`/`renderEdge` aqui e garanta que o backend os inclua no snapshot.
 */
(function () {
  const HEALTH_LABEL = {
    healthy: 'Saudável', degraded: 'Degradado', critical: 'Crítico',
    blocked: 'Bloqueado', unknown: 'Desconhecido',
  };
  const HEALTH_COLOR = {
    healthy: '#22c55e', degraded: '#eab308', critical: '#ef4444',
    blocked: '#6b7280', unknown: '#9ca3af',
  };
  const DEVICE_LABEL = {
    host: 'Host', controller: 'Controlador SDN', worker: 'Worker',
    database: 'Banco de Dados', monitor: 'Observabilidade',
  };
  const KIND_LABEL = { normal: 'Normal', anomalous: 'Anômalo', control: 'Controle' };
  const PLANE_LABEL = { control: 'Plano de controle', data: 'Plano de dados' };
  const PLANE_COLOR = { control: '#a855f7', data: '#38bdf8' };

  let panel, body;
  let selection = null; // { kind:'node'|'edge', id }
  let snapshot = null;
  // View persistente do no selecionado. Mantem o bloco de Configuracoes (com o
  // <select>) vivo no DOM entre snapshots: so as secoes de dados ao vivo sao
  // reconstruidas a cada refresh, evitando que o dropdown aberto seja destruido.
  let nodeView = null; // { id, live, config }

  const v = (x, suffix = '') => (x === null || x === undefined || x === '' ? '—' : x + suffix);

  function init(container) {
    panel = document.createElement('div');
    panel.style.cssText =
      'position:absolute;top:0;right:0;width:280px;height:100%;background:rgba(10,10,18,0.95);' +
      'border-left:1px solid #1f2937;padding:0;overflow-y:auto;font-size:12px;z-index:30;' +
      'transform:translateX(100%);transition:transform .22s ease;box-shadow:-8px 0 24px rgba(0,0,0,0.4);';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;' +
      'border-bottom:1px solid #1f2937;position:sticky;top:0;background:rgba(10,10,18,0.98);';
    const title = document.createElement('div');
    title.id = 'topo-panel-title';
    title.style.cssText = 'color:#e5e7eb;font-weight:bold;font-size:12px;text-transform:uppercase;letter-spacing:1px;';
    title.textContent = 'Detalhes';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'background:none;border:none;color:#6b7280;cursor:pointer;font-size:14px;';
    close.onmouseenter = () => (close.style.color = '#e5e7eb');
    close.onmouseleave = () => (close.style.color = '#6b7280');
    close.onclick = hide;
    header.appendChild(title);
    header.appendChild(close);

    body = document.createElement('div');
    body.style.cssText = 'padding:14px;display:flex;flex-direction:column;gap:14px;';

    panel.appendChild(header);
    panel.appendChild(body);
    container.appendChild(panel);
  }

  function section(label, rows) {
    const wrap = document.createElement('div');
    const h = document.createElement('div');
    h.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:6px;';
    h.textContent = label;
    wrap.appendChild(h);
    for (const [k, val, color] of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #161d2b;';
      const a = document.createElement('span'); a.style.color = '#9ca3af'; a.textContent = k;
      const b = document.createElement('span'); b.style.color = color || '#e5e7eb'; b.textContent = val;
      row.appendChild(a); row.appendChild(b);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderNode(node) {
    document.getElementById('topo-panel-title').textContent = node.label || node.id;

    // (Re)constroi a estrutura apenas quando muda o no selecionado. O bloco de
    // Configuracoes e criado uma unica vez e permanece no DOM entre refreshes —
    // assim o <select> nao e destruido/recriado a cada snapshot (2s), o que antes
    // fazia o dropdown aberto "sumir" ao mexer o mouse.
    if (!nodeView || nodeView.id !== node.id) {
      body.innerHTML = '';
      const live = document.createElement('div');
      live.style.cssText = 'display:flex;flex-direction:column;gap:14px;';
      const config = buildNodeConfig(node);
      body.appendChild(live);
      body.appendChild(config.el);
      nodeView = { id: node.id, live, config };
    }

    renderNodeLive(nodeView.live, node);
    nodeView.config.update(node);
  }

  // Reconstroi somente as secoes de dados ao vivo (sem tocar nos controles).
  function renderNodeLive(container, node) {
    container.innerHTML = '';

    const dot = HEALTH_COLOR[node.health] || '#9ca3af';
    container.appendChild(section('Dispositivo', [
      ['Tipo', DEVICE_LABEL[node.deviceType] || node.deviceType || node.type],
      ['Plano SDN', PLANE_LABEL[node.plane] || v(node.plane), PLANE_COLOR[node.plane]],
      ['ID', node.id],
      ['IP', v(node.ip)],
      ['MAC', v(node.mac)],
      ['Status', HEALTH_LABEL[node.health] || node.health, dot],
    ]));

    const m = node.metrics || {};
    container.appendChild(section('Métricas', [
      ['Throughput (rps)', v(m.rps)],
      ['Latência média', v(m.avgLatency, ' ms')],
      ['Taxa de erro', ((m.errorRate || 0) * 100).toFixed(1) + '%'],
      ['Em voo', v(m.inFlight)],
      ['Flows ativos', v(m.activeFlows)],
    ]));

    // conexoes ativas
    const conns = (snapshot ? snapshot.edges : []).filter((e) => e.from === node.id || e.to === node.id);
    const wrap = document.createElement('div');
    const h = document.createElement('div');
    h.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:6px;';
    h.textContent = 'Conexões ativas (' + conns.length + ')';
    wrap.appendChild(h);
    if (conns.length === 0) {
      const e = document.createElement('div'); e.style.color = '#4b5563'; e.textContent = 'Nenhuma';
      wrap.appendChild(e);
    }
    for (const e of conns) {
      const other = e.from === node.id ? e.to : e.from;
      const dir = e.from === node.id ? '→ ' : '← ';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #161d2b;';
      const a = document.createElement('span'); a.style.color = '#9ca3af'; a.textContent = dir + other;
      const b = document.createElement('span'); b.style.color = e.blocked ? '#ef4444' : '#e5e7eb';
      b.textContent = e.blocked ? 'bloqueado' : e.rps + ' rps';
      row.appendChild(a); row.appendChild(b);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  // Constroi o bloco de Configuracoes uma unica vez. Retorna o elemento e uma
  // funcao update(node) que sincroniza o estado dos controles com o no atual,
  // sem recriar o <select> (preservando interacao/foco do usuario).
  function buildNodeConfig(node) {
    const wrap = document.createElement('div');

    const h = document.createElement('div');
    h.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:6px;';
    h.textContent = 'Configurações';
    wrap.appendChild(h);

    // Toggle desabilitar / reativar
    const toggle = document.createElement('button');
    toggle.style.cssText =
      'width:100%;background:#1f2937;border:1px solid #374151;color:#d1d5db;border-radius:5px;' +
      'padding:7px 0;font-size:11px;cursor:pointer;margin-bottom:6px;';
    toggle.onmouseenter = () => { if (!toggle.disabled) toggle.style.background = '#374151'; };
    toggle.onmouseleave = () => { if (!toggle.disabled) toggle.style.background = '#1f2937'; };
    toggle.onclick = () => {
      const isBlocked = node.health === 'blocked';
      const endpoint = isBlocked
        ? '/api/sdn/nodes/' + node.id + '/enable'
        : '/api/sdn/nodes/' + node.id + '/disable';
      toggle.textContent = 'Aguarde…';
      toggle.disabled = true;
      toggle.style.opacity = '0.5';
      fetch(endpoint, { method: 'POST' }).catch(function (err) { console.error(err); });
    };
    wrap.appendChild(toggle);

    // Dropdown de health
    const selWrap = document.createElement('div');
    selWrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const selLabel = document.createElement('span');
    selLabel.style.cssText = 'color:#9ca3af;font-size:11px;white-space:nowrap;';
    selLabel.textContent = 'Status';
    const sel = document.createElement('select');
    sel.style.cssText =
      'flex:1;background:#1f2937;border:1px solid #374151;color:#e5e7eb;border-radius:5px;' +
      'padding:5px 6px;font-size:11px;cursor:pointer;outline:none;';
    const opts = [
      { value: '', label: 'Automático' },
      { value: 'healthy', label: 'Saudável', color: '#22c55e' },
      { value: 'degraded', label: 'Degradado', color: '#eab308' },
      { value: 'critical', label: 'Crítico', color: '#ef4444' },
      { value: 'blocked', label: 'Bloqueado', color: '#6b7280' },
      { value: 'unknown', label: 'Desconhecido', color: '#9ca3af' },
    ];
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = o.value;
      el.textContent = o.label;
      if (o.color) el.style.color = o.color;
      sel.appendChild(el);
    }
    sel.value = '';
    // Marca quando o usuario esta interagindo para o update() nao mexer no select.
    sel.onfocus = () => { sel.dataset.active = '1'; };
    sel.onblur = () => { delete sel.dataset.active; };
    sel.onchange = function () {
      if (sel.value === '') {
        fetch('/api/sdn/nodes/' + node.id + '/reset', { method: 'POST' }).catch(console.error);
      } else {
        fetch('/api/sdn/nodes/' + node.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ health: sel.value }),
        }).catch(console.error);
      }
      sel.blur();
    };
    selWrap.appendChild(selLabel);
    selWrap.appendChild(sel);
    wrap.appendChild(selWrap);

    // Botao reset
    const reset = document.createElement('button');
    reset.textContent = '↺ Restaurar padrões';
    reset.style.cssText =
      'width:100%;background:transparent;border:1px solid #374151;color:#6b7280;border-radius:5px;' +
      'padding:5px 0;font-size:10px;cursor:pointer;';
    reset.onmouseenter = () => { reset.style.color = '#d1d5db'; reset.style.borderColor = '#4b5563'; };
    reset.onmouseleave = () => { reset.style.color = '#6b7280'; reset.style.borderColor = '#374151'; };
    reset.onclick = function () {
      reset.textContent = 'Aguarde…';
      reset.disabled = true;
      reset.style.opacity = '0.5';
      fetch('/api/sdn/nodes/' + node.id + '/reset', { method: 'POST' })
        .catch(console.error)
        .finally(() => {
          reset.textContent = '↺ Restaurar padrões';
          reset.disabled = false;
          reset.style.opacity = '1';
          sel.value = '';
        });
    };
    wrap.appendChild(reset);

    // Injecao de falha — so para nos do tipo worker. Define uma taxa de erro
    // intrinseca naquele worker (independente do trafego), fazendo so ele degradar
    // para o Datadog perceber e o closed-loop migrar a rota.
    if (node.type === 'worker') {
      const faultWrap = document.createElement('div');
      faultWrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #1f2937;';

      const fh = document.createElement('div');
      fh.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:6px;';
      fh.textContent = 'Injeção de falha';
      faultWrap.appendChild(fh);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:#9ca3af;font-size:11px;white-space:nowrap;';
      lbl.textContent = 'Erro';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0'; range.max = '100'; range.value = '80';
      range.style.cssText = 'flex:1;accent-color:#ef4444;';
      const pct = document.createElement('span');
      pct.style.cssText = 'color:#ef4444;font-size:11px;width:34px;text-align:right;';
      pct.textContent = '80%';
      range.oninput = () => { pct.textContent = range.value + '%'; };
      row.appendChild(lbl); row.appendChild(range); row.appendChild(pct);
      faultWrap.appendChild(row);

      const postFault = (rate, btn, okText) => {
        const prev = btn.textContent;
        btn.textContent = 'Aguarde…'; btn.disabled = true; btn.style.opacity = '0.5';
        fetch('/api/sdn/workers/' + node.id + '/fault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errorRate: rate }),
        }).catch(console.error).finally(() => {
          btn.textContent = okText || prev; btn.disabled = false; btn.style.opacity = '1';
        });
      };

      const inject = document.createElement('button');
      inject.textContent = '⚠ Injetar falha';
      inject.style.cssText =
        'width:100%;background:#3b1418;border:1px solid #7f1d1d;color:#fca5a5;border-radius:5px;' +
        'padding:7px 0;font-size:11px;cursor:pointer;margin-bottom:6px;';
      inject.onmouseenter = () => { if (!inject.disabled) inject.style.background = '#5b1a1f'; };
      inject.onmouseleave = () => { if (!inject.disabled) inject.style.background = '#3b1418'; };
      inject.onclick = () => postFault(parseInt(range.value, 10) / 100, inject, '⚠ Injetar falha');
      faultWrap.appendChild(inject);

      const clearFault = document.createElement('button');
      clearFault.textContent = '✓ Limpar falha';
      clearFault.style.cssText =
        'width:100%;background:transparent;border:1px solid #374151;color:#6b7280;border-radius:5px;' +
        'padding:5px 0;font-size:10px;cursor:pointer;';
      clearFault.onmouseenter = () => { clearFault.style.color = '#d1d5db'; clearFault.style.borderColor = '#4b5563'; };
      clearFault.onmouseleave = () => { clearFault.style.color = '#6b7280'; clearFault.style.borderColor = '#374151'; };
      clearFault.onclick = () => postFault(0, clearFault, '✓ Limpar falha');
      faultWrap.appendChild(clearFault);

      wrap.appendChild(faultWrap);
    }

    function update(n) {
      const isBlocked = n.health === 'blocked';
      toggle.textContent = isBlocked ? '▶ Reativar nó' : '⏹ Desabilitar nó';
      toggle.disabled = false;
      toggle.style.opacity = '1';
      // Nunca recriar/alterar o <select> enquanto o usuario interage com ele.
      if (sel.dataset.active !== '1') {
        sel.disabled = false;
        sel.style.opacity = '1';
      }
    }

    return { el: wrap, update };
  }

  function renderEdge(edge) {
    document.getElementById('topo-panel-title').textContent = edge.from + ' → ' + edge.to;
    nodeView = null;
    body.innerHTML = '';
    const kindColor = edge.trafficKind === 'anomalous' ? '#ef4444'
      : edge.trafficKind === 'control' ? '#a855f7' : '#38bdf8';
    body.appendChild(section('Conexão', [
      ['Origem', edge.from],
      ['Destino', edge.to],
      ['Plano SDN', PLANE_LABEL[edge.plane] || v(edge.plane), PLANE_COLOR[edge.plane]],
      ['Tipo de tráfego', KIND_LABEL[edge.trafficKind] || edge.trafficKind, kindColor],
      ['Estado', edge.blocked ? 'Bloqueado' : 'Ativo', edge.blocked ? '#ef4444' : '#22c55e'],
    ]));
    body.appendChild(section('Link', [
      ['Largura de banda', v(edge.bandwidthMbps, ' Mbps')],
      ['Utilização', ((edge.utilization || 0) * 100).toFixed(1) + '%'],
      ['Latência', v(edge.latencyMs, ' ms')],
      ['Perda de pacotes', ((edge.packetLoss || 0) * 100).toFixed(2) + '%'],
      ['Tráfego atual', v(edge.rps, ' rps')],
    ]));
  }

  function show() { panel.style.transform = 'translateX(0)'; }
  function hide() { panel.style.transform = 'translateX(100%)'; selection = null; nodeView = null; }

  function showNode(node, snap) {
    snapshot = snap || snapshot;
    selection = { kind: 'node', id: node.id };
    renderNode(node);
    show();
  }
  function showEdge(edge, snap) {
    snapshot = snap || snapshot;
    selection = { kind: 'edge', id: edge.from + '>' + edge.to };
    renderEdge(edge);
    show();
  }

  // Re-renderiza com dados frescos quando chega um novo snapshot.
  function refresh(snap) {
    snapshot = snap;
    if (!selection) return;
    if (selection.kind === 'node') {
      const n = snap.nodes.find((x) => x.id === selection.id);
      if (n) renderNode(n); else hide();
    } else {
      const [from, to] = selection.id.split('>');
      const e = snap.edges.find((x) => x.from === from && x.to === to);
      if (e) renderEdge(e); else hide();
    }
  }

  window.Topo = window.Topo || {};
  window.Topo.panels = { init, showNode, showEdge, refresh, close: hide };
})();
