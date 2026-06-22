/*
 * topology/main.js — ORQUESTRADOR
 * -------------------------------
 * Conecta as camadas: dados -> fisica -> render -> pacotes -> paineis.
 * Roda o loop de animacao (requestAnimationFrame): tick da fisica, atualiza
 * posicoes no SVG e move os pacotes. Trata resize/visibilidade do container.
 *
 * Ordem de carga dos scripts (ver index.html):
 *   d3 (CDN) -> data -> physics -> renderer -> packets -> panels -> settings -> main
 */
(function () {
  const container = document.getElementById('topology-container');
  if (!container || !window.d3) {
    if (!window.d3) console.error('[topology] d3 nao carregou — verifique a tag <script> do CDN.');
    return;
  }
  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  let latest = null;
  let booted = false;

  // 1) Renderer cria o SVG e devolve o grupo de pacotes + dimensoes
  const cbs = {
    onNodeClick: (nodeData) => Topo.panels.showNode(nodeData, latest),
    onEdgeClick: (edgeData) => Topo.panels.showEdge(edgeData, latest),
    onBackgroundClick: () => Topo.panels.close(),
  };
  const r = Topo.renderer.init(container, cbs);

  // 2) Fisica e pacotes
  Topo.physics.init(r.width, r.height);
  Topo.packets.init(r.packetsGroup);

  // 3) Paineis e settings
  Topo.panels.init(container);
  Topo.settings.init(container, { onReset: () => {}, onPauseToggle: () => {} });

  // 4) Fonte de dados -> aplica cada snapshot
  Topo.data.start((snapshot) => {
    latest = snapshot;
    const { nodes, links } = Topo.physics.setGraph(snapshot);
    Topo.renderer.setGraph(nodes, links);
    Topo.packets.setEdges(links);
    Topo.panels.refresh(snapshot);
    booted = true;
  });

  // 5) Loop de animacao
  function frame() {
    if (booted) {
      if (!Topo.physics.isPaused()) Topo.physics.tick();
      Topo.renderer.updatePositions();
      Topo.packets.tick();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 6) Responsivo: ResizeObserver cobre tanto redimensionamento da janela
  //    quanto a transicao de aba oculta (0px) -> visivel (tamanho real).
  let lastW = 0, lastH = 0;
  const ro = new ResizeObserver(() => {
    const rect = container.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    if (Math.abs(rect.width - lastW) < 2 && Math.abs(rect.height - lastH) < 2) return;
    lastW = rect.width; lastH = rect.height;
    Topo.renderer.resize(container);
    Topo.physics.resize(rect.width, rect.height);
    Topo.physics.reheat(0.4);
  });
  ro.observe(container);
})();
