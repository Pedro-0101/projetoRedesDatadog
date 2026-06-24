/*
 * topology/renderer.js — CAMADA DE RENDERIZACAO (SVG via D3)
 * ---------------------------------------------------------
 * Renderiza nos/arestas/labels e trata interacoes: arrastar, zoom, pan e
 * highlight de vizinhanca no hover. NAO conhece fisica nem dados crus — recebe
 * os arrays de nos/links (objetos compartilhados com a fisica, com x/y) e
 * desenha. Esta camada e ISOLADA atras de uma interface
 * (`init/setGraph/updatePositions/setAppearance/highlight/setFilter`): para
 * migrar a Canvas/WebGL (PixiJS) por performance, reimplemente este modulo
 * mantendo a mesma interface — fisica/dados/pacotes nao mudam.
 */
(function () {
  const d3 = window.d3;

  const HEALTH_COLORS = {
    healthy: '#22c55e', degraded: '#eab308', critical: '#ef4444',
    blocked: '#6b7280', unknown: '#9ca3af',
  };
  const HEALTH_BG = {
    healthy: 'rgba(34,197,94,0.15)', degraded: 'rgba(234,179,8,0.15)',
    critical: 'rgba(239,68,68,0.15)', blocked: 'rgba(107,114,128,0.15)',
    unknown: 'rgba(156,163,175,0.08)',
  };
  const ICONS = { client: '🖥', api: '⚡', worker: '⚙', db: '🗄', datadog: '📊' };
  const EDGE_COLOR = { normal: '#4b5563', anomalous: '#ef4444', control: '#a855f7' };

  let svg, root, edgesG, packetsG, nodesG;
  let width = 800, height = 600;
  let callbacks = {};
  let nodes = [], links = [];
  let adjacency = new Map(); // id -> Set de vizinhos
  let appearance = { nodeSize: 1, edgeWidth: 1, showLabels: true };
  let visible = () => true;
  let hovered = null;

  function computeRadius(node) {
    return appearance.nodeSize * (10 + Math.sqrt(node.degree || 0) * 6);
  }

  function init(container, cbs) {
    callbacks = cbs || {};
    container.innerHTML = '';
    const rect = container.getBoundingClientRect();
    width = rect.width || 800;
    height = rect.height || 600;

    svg = d3.select(container).append('svg')
      .attr('width', '100%').attr('height', '100%')
      .style('display', 'block').style('cursor', 'grab');

    // defs: glow + seta
    const defs = svg.append('defs');
    const f = defs.append('filter').attr('id', 'topo-glow');
    f.append('feGaussianBlur').attr('stdDeviation', '2.5').attr('result', 'b');
    const m = f.append('feMerge');
    m.append('feMergeNode').attr('in', 'b');
    m.append('feMergeNode').attr('in', 'SourceGraphic');

    root = svg.append('g'); // grupo transformado por zoom/pan
    edgesG = root.append('g').attr('class', 'edges');
    packetsG = root.append('g').attr('class', 'packets');
    nodesG = root.append('g').attr('class', 'nodes');

    // zoom + pan
    const zoom = d3.zoom().scaleExtent([0.2, 4])
      .on('zoom', (event) => root.attr('transform', event.transform));
    svg.call(zoom);
    svg.on('dblclick.zoom', null); // duplo-clique nao da zoom (usado p/ soltar no)

    // clique no fundo fecha paineis
    svg.on('click', (event) => {
      if (event.target === svg.node()) callbacks.onBackgroundClick && callbacks.onBackgroundClick();
    });

    return { packetsGroup: packetsG.node(), width, height };
  }

  function buildAdjacency() {
    adjacency = new Map();
    for (const n of nodes) adjacency.set(n.id, new Set());
    for (const l of links) {
      adjacency.get(l.source.id)?.add(l.target.id);
      adjacency.get(l.target.id)?.add(l.source.id);
    }
  }

  function setGraph(n, l) {
    nodes = n; links = l;
    buildAdjacency();

    // ---- arestas ----
    const edgeSel = edgesG.selectAll('line.edge').data(links, (d) => d.source.id + '>' + d.target.id);
    edgeSel.exit().remove();
    const edgeEnter = edgeSel.enter().append('line')
      .attr('class', 'edge')
      .attr('stroke-linecap', 'round')
      .style('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); callbacks.onEdgeClick && callbacks.onEdgeClick(d.data, d); });
    edgeEnter.merge(edgeSel)
      .attr('stroke', (d) => EDGE_COLOR[d.data.trafficKind] || EDGE_COLOR.normal)
      .attr('stroke-width', (d) => appearance.edgeWidth * Math.max(1, Math.min(7, 1 + d.data.utilization * 6)))
      .attr('stroke-opacity', (d) => (d.data.blocked ? 0.55 : d.data.rps > 0 ? 0.8 : 0.25))
      // bloqueado: tracejado curto; plano de controle: tracejado pontilhado; dados: solido
      .attr('stroke-dasharray', (d) => (d.data.blocked ? '5,4' : d.data.plane === 'control' ? '2,5' : null));

    // ---- nos ----
    const nodeSel = nodesG.selectAll('g.node').data(nodes, (d) => d.id);
    nodeSel.exit().remove();
    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); callbacks.onNodeClick && callbacks.onNodeClick(d.data, d); })
      .on('mouseenter', (event, d) => { hovered = d.id; applyHighlight(); })
      .on('mouseleave', () => { hovered = null; applyHighlight(); })
      .on('dblclick', (event, d) => { event.stopPropagation(); Topo.physics.dragEnd(d, false); Topo.physics.reheat(0.5); });

    nodeEnter.append('circle').attr('class', 'node-bg');
    nodeEnter.append('text').attr('class', 'node-icon')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .style('pointer-events', 'none');
    nodeEnter.append('text').attr('class', 'node-label')
      .attr('text-anchor', 'middle').attr('fill', '#9ca3af')
      .attr('font-size', '10').style('pointer-events', 'none');

    // drag
    nodeEnter.call(d3.drag()
      // impede que o mousedown no no acione tambem o pan do zoom
      .on('start', (event, d) => { if (event.sourceEvent) event.sourceEvent.stopPropagation(); Topo.physics.dragStart(); })
      .on('drag', (event, d) => { Topo.physics.dragMove(d, event.x, event.y); })
      .on('end', (event, d) => { Topo.physics.dragEnd(d, true); })); // fixa ao soltar

    const nodeMerge = nodeEnter.merge(nodeSel);
    nodeMerge.select('circle.node-bg')
      .attr('r', (d) => computeRadius(d))
      .attr('fill', (d) => HEALTH_BG[d.data.health] || HEALTH_BG.unknown)
      .attr('stroke', (d) => HEALTH_COLORS[d.data.health] || HEALTH_COLORS.unknown)
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', (d) => (d.data.type === 'client' ? '4' : null))
      .attr('filter', 'url(#topo-glow)');
    nodeMerge.select('text.node-icon')
      .attr('font-size', (d) => Math.max(12, computeRadius(d) * 0.9))
      .text((d) => ICONS[d.data.type] || '●');
    nodeMerge.select('text.node-label')
      .attr('y', (d) => computeRadius(d) + 13)
      .text((d) => d.data.label);

    applyAppearance();
    applyVisibility();
    applyHighlight();
    updatePositions();
  }

  function updatePositions() {
    nodesG.selectAll('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
    edgesG.selectAll('line.edge').each(function (d) {
      const sr = computeRadius(d.source), tr = computeRadius(d.target);
      const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      this.setAttribute('x1', d.source.x + nx * sr);
      this.setAttribute('y1', d.source.y + ny * sr);
      this.setAttribute('x2', d.target.x - nx * tr);
      this.setAttribute('y2', d.target.y - ny * tr);
    });
  }

  // ---- aparencia ao vivo ----
  function setAppearance(opts) { Object.assign(appearance, opts); applyAppearance(); setGraphRefresh(); }
  function applyAppearance() {
    nodesG.selectAll('text.node-label').style('display', appearance.showLabels ? null : 'none');
  }
  // re-aplica tamanhos sem rebind completo
  function setGraphRefresh() {
    nodesG.selectAll('circle.node-bg').attr('r', (d) => computeRadius(d));
    nodesG.selectAll('text.node-icon').attr('font-size', (d) => Math.max(12, computeRadius(d) * 0.9));
    nodesG.selectAll('text.node-label').attr('y', (d) => computeRadius(d) + 13);
    edgesG.selectAll('line.edge')
      .attr('stroke-width', (d) => appearance.edgeWidth * Math.max(1, Math.min(7, 1 + d.data.utilization * 6)));
  }

  // ---- highlight de vizinhanca (hover) ----
  function applyHighlight() {
    if (!hovered) {
      nodesG.selectAll('g.node').style('opacity', (d) => (visible(d.data) ? 1 : 0.06));
      edgesG.selectAll('line.edge').style('opacity', null);
      return;
    }
    const neigh = adjacency.get(hovered) || new Set();
    nodesG.selectAll('g.node').style('opacity', (d) => {
      if (!visible(d.data)) return 0.06;
      return d.id === hovered || neigh.has(d.id) ? 1 : 0.12;
    });
    edgesG.selectAll('line.edge').style('opacity', (d) => {
      const on = d.source.id === hovered || d.target.id === hovered;
      return on ? 0.95 : 0.05;
    });
  }

  // ---- filtros (por tipo/status) ----
  function setFilter(pred) { visible = pred || (() => true); applyVisibility(); applyHighlight(); }
  function applyVisibility() {
    nodesG.selectAll('g.node').style('display', (d) => (visible(d.data) ? null : 'none'));
    edgesG.selectAll('line.edge').style('display', (d) =>
      (visible(d.source.data) && visible(d.target.data) ? null : 'none'));
  }

  function resize(container) {
    const rect = container.getBoundingClientRect();
    width = rect.width || width; height = rect.height || height;
    return { width, height };
  }

  window.Topo = window.Topo || {};
  window.Topo.renderer = {
    init, setGraph, updatePositions, setAppearance, setFilter, resize,
    highlight: (id) => { hovered = id; applyHighlight(); },
    EDGE_COLOR, HEALTH_COLORS,
  };
})();
