/*
 * topology/packets.js — ANIMACAO DE PACOTES EM TEMPO REAL
 * ------------------------------------------------------
 * Desenha "pacotes" (pontos luminosos) percorrendo as arestas da origem ao
 * destino. As posicoes sao recalculadas a CADA FRAME a partir das coords atuais
 * dos nos, entao os pacotes seguem o movimento do grafo. A densidade e a
 * velocidade refletem o trafego do link (utilization/rps); a cor reflete o
 * `trafficKind` (normal/anomalous/control) e e parametrizavel.
 *
 * Renderiza no mesmo grupo transformado por zoom/pan do renderer, entao
 * compartilha o sistema de coordenadas dos nos automaticamente.
 *
 * >>> FONTE DE TRAFEGO <<< vem dos links (campo `data.utilization`/`data.rps`),
 * que por sua vez vem de `Topo.data`. Para usar outra fonte, ajuste `Topo.data`.
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  let group = null;       // <g> SVG onde os pacotes vivem
  let links = [];         // referencia viva aos links da fisica/renderer
  let packets = [];
  const MAX_PACKETS = 600;

  const config = {
    enabled: true,
    speed: 1,
    density: 1,
    colors: { normal: '#38bdf8', anomalous: '#ef4444', control: '#a855f7' },
  };

  function init(svgGroupNode) {
    group = svgGroupNode;
  }

  function setEdges(l) { links = l; }

  function clear() {
    if (group) while (group.firstChild) group.removeChild(group.firstChild);
    packets = [];
  }

  function spawn(link) {
    if (packets.length >= MAX_PACKETS) return;
    const kind = link.data.trafficKind || 'normal';
    const color = config.colors[kind] || config.colors.normal;
    const util = Math.max(0.05, link.data.utilization || 0);
    const p = {
      link,
      progress: 0,
      speed: (0.010 + 0.018 * util) * config.speed,
      size: 1.8 + Math.random() * 1.8,
      color,
    };
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('r', String(p.size));
    el.setAttribute('fill', color);
    el.setAttribute('filter', 'url(#topo-glow)');
    el.setAttribute('opacity', '0');
    group.appendChild(el);
    p.el = el;
    packets.push(p);
  }

  function tick() {
    if (!group) return;

    // Spawning proporcional ao trafego de cada link
    if (config.enabled) {
      for (const link of links) {
        const d = link.data;
        if (!d || d.rps <= 0 || d.blocked) continue;
        const chance = Math.min(0.5, (d.utilization || 0) * 0.18 + d.rps * 0.004) * config.density;
        if (Math.random() < chance) spawn(link);
      }
    }

    // Move/recalcula pacotes existentes
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.progress += p.speed;
      if (p.progress >= 1) {
        p.el.remove();
        packets.splice(i, 1);
        continue;
      }
      const s = p.link.source, t = p.link.target;
      p.el.setAttribute('cx', String(s.x + (t.x - s.x) * p.progress));
      p.el.setAttribute('cy', String(s.y + (t.y - s.y) * p.progress));
      const fade = p.progress < 0.12 ? p.progress / 0.12
        : p.progress > 0.88 ? (1 - p.progress) / 0.12 : 1;
      p.el.setAttribute('opacity', String(fade * 0.85));
    }
  }

  function setConfig(opts) {
    Object.assign(config, opts);
    if (opts && opts.enabled === false) clear();
  }

  window.Topo = window.Topo || {};
  window.Topo.packets = { init, setEdges, tick, setConfig, clear, getConfig: () => config };
})();
