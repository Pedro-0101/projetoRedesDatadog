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

  let panel, body;
  let selection = null; // { kind:'node'|'edge', id }
  let snapshot = null;

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
    body.innerHTML = '';

    const dot = HEALTH_COLOR[node.health] || '#9ca3af';
    body.appendChild(section('Dispositivo', [
      ['Tipo', DEVICE_LABEL[node.deviceType] || node.deviceType || node.type],
      ['ID', node.id],
      ['IP', v(node.ip)],
      ['MAC', v(node.mac)],
      ['Status', HEALTH_LABEL[node.health] || node.health, dot],
    ]));

    const m = node.metrics || {};
    body.appendChild(section('Métricas', [
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
    body.appendChild(wrap);
  }

  function renderEdge(edge) {
    document.getElementById('topo-panel-title').textContent = edge.from + ' → ' + edge.to;
    body.innerHTML = '';
    const kindColor = edge.trafficKind === 'anomalous' ? '#ef4444'
      : edge.trafficKind === 'control' ? '#a855f7' : '#38bdf8';
    body.appendChild(section('Conexão', [
      ['Origem', edge.from],
      ['Destino', edge.to],
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
  function hide() { panel.style.transform = 'translateX(100%)'; selection = null; }

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
