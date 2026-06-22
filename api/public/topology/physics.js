/*
 * topology/physics.js — MOTOR DE FISICA (force-directed, estilo Obsidian)
 * ----------------------------------------------------------------------
 * Wrapper sobre d3-force. NAO renderiza nada — apenas mantem as posicoes
 * (x,y) dos nos via simulacao continua. O `main` chama `tick()` por frame.
 *
 * Forcas: charge (repulsao), link (mola + distancia), center (centralizacao),
 * collide (evita sobreposicao). Todos os parametros sao ajustaveis ao vivo
 * pelo painel de settings via `setParam()`.
 *
 * Mantem o estado dos nos entre snapshots (merge por id), preservando x/y para
 * o layout nao "explodir" a cada atualizacao de 2s do backend.
 */
(function () {
  const d3 = window.d3;

  let sim = null;
  let width = 800, height = 600;
  let nodes = [];
  let links = [];
  const nodeById = new Map();
  // Assinatura estrutural do ultimo grafo (ids de nos + pares de arestas).
  // Usada para so reaquecer a simulacao quando a TOPOLOGIA muda — atualizacoes
  // que so mexem em metricas (rps/health) nao devem reaquecer, senao o layout
  // "respira"/contrai a cada snapshot de 2s.
  let lastSig = '';

  const params = {
    centerStrength: 0.05,
    repelStrength: -240,
    linkStrength: 0.5,
    linkDistance: 90,
    collide: 34,
  };

  function init(w, h) {
    width = w; height = h;
    sim = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(params.repelStrength))
      .force('link', d3.forceLink(links).id((d) => d.id)
        .distance(params.linkDistance).strength(params.linkStrength))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(params.centerStrength))
      .force('collide', d3.forceCollide(params.collide))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03))
      .alphaDecay(0.02)
      .stop(); // tick manual via RAF
  }

  // Merge do snapshot nos arrays existentes, preservando posicoes.
  function setGraph(snapshot) {
    const incomingIds = new Set(snapshot.nodes.map((n) => n.id));

    // Atualiza/insere nos
    for (const n of snapshot.nodes) {
      let node = nodeById.get(n.id);
      if (!node) {
        node = {
          id: n.id,
          // posicao inicial proxima ao centro com leve dispersao (anima entrada)
          x: width / 2 + (Math.random() - 0.5) * 120,
          y: height / 2 + (Math.random() - 0.5) * 120,
        };
        nodeById.set(n.id, node);
        nodes.push(node);
      }
      // copia campos de dados (sem mexer em x,y,vx,vy,fx,fy)
      node.data = n;
    }
    // Remove nos ausentes
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!incomingIds.has(nodes[i].id)) {
        nodeById.delete(nodes[i].id);
        nodes.splice(i, 1);
      }
    }

    // Reconstroi links referenciando objetos de no
    links.length = 0;
    const degree = new Map();
    for (const e of snapshot.edges) {
      const source = nodeById.get(e.from);
      const target = nodeById.get(e.to);
      if (!source || !target) continue;
      links.push({ source, target, data: e });
      degree.set(e.from, (degree.get(e.from) || 0) + 1);
      degree.set(e.to, (degree.get(e.to) || 0) + 1);
    }
    // grau -> usado pelo renderer para dimensionar o no
    for (const node of nodes) node.degree = degree.get(node.id) || 0;

    sim.nodes(nodes);
    sim.force('link').links(links);

    // So reaquece se a ESTRUTURA mudou (nos/arestas adicionados ou removidos).
    // Snapshots que so atualizam metricas mantem o layout parado -> sem contracao.
    const sig = nodes.map((n) => n.id).sort().join(',') + '|'
      + links.map((l) => l.source.id + '>' + l.target.id).sort().join(',');
    if (sig !== lastSig) {
      lastSig = sig;
      if (sim.alpha() < 0.1) sim.alpha(0.3);
    }
    return { nodes, links };
  }

  function tick() {
    if (sim && sim.alpha() > sim.alphaMin()) sim.tick();
  }

  function setParam(name, value) {
    params[name] = value;
    if (!sim) return;
    if (name === 'repelStrength') sim.force('charge').strength(value);
    else if (name === 'linkDistance') sim.force('link').distance(value);
    else if (name === 'linkStrength') sim.force('link').strength(value);
    else if (name === 'centerStrength') sim.force('center').strength(value);
    else if (name === 'collide') sim.force('collide').radius(value);
    sim.alpha(Math.max(sim.alpha(), 0.3)); // reaquece para aplicar a mudanca
  }

  function reheat(a) { if (sim) sim.alpha(a || 0.6); }
  function resize(w, h) {
    width = w; height = h;
    if (sim) sim.force('center').x(w / 2).y(h / 2);
  }

  // Controle de pausa
  let paused = false;
  function pause() { paused = true; }
  function resume() { paused = false; reheat(0.3); }
  function isPaused() { return paused; }

  // Drag: fixa o no enquanto arrastado; main decide soltar/fixar.
  function dragStart() { reheat(0.4); }
  function dragMove(node, x, y) { node.fx = x; node.fy = y; }
  function dragEnd(node, fix) {
    if (fix) { node.fx = node.x; node.fy = node.y; }
    else { node.fx = null; node.fy = null; }
  }
  function unfixAll() { for (const n of nodes) { n.fx = null; n.fy = null; } reheat(0.6); }

  window.Topo = window.Topo || {};
  window.Topo.physics = {
    init, setGraph, tick, setParam, reheat, resize,
    pause, resume, isPaused,
    dragStart, dragMove, dragEnd, unfixAll,
    getNodes: () => nodes,
    getLinks: () => links,
    getParams: () => params,
  };
})();
