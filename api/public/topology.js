(function () {
  const container = document.getElementById('topology-container');
  if (!container) return;

  const NS = 'http://www.w3.org/2000/svg';

  const NODE_POSITIONS = {
    browser: { x: 400, y: 30 },
    api: { x: 400, y: 130 },
    'worker-a': { x: 150, y: 260 },
    'worker-b': { x: 400, y: 280 },
    'worker-c': { x: 650, y: 260 },
    postgres: { x: 400, y: 400 },
    datadog: { x: 400, y: 490 },
  };

  const NODE_RADIUS = 28;
  const HEALTH_COLORS = {
    healthy: '#22c55e',
    degraded: '#eab308',
    critical: '#ef4444',
    blocked: '#6b7280',
    unknown: '#9ca3af',
  };
  const HEALTH_BG = {
    healthy: 'rgba(34,197,94,0.15)',
    degraded: 'rgba(234,179,8,0.15)',
    critical: 'rgba(239,68,68,0.15)',
    blocked: 'rgba(107,114,128,0.15)',
    unknown: 'rgba(156,163,175,0.08)',
  };

  let svg, defs, edgesGroup, particlesGroup, nodesGroup, labelsGroup;
  let tooltipEl, sidePanel, rulesList, workerTable;
  let currentData = null;
  let animFrameId = null;
  let particles = [];

  function setupUI() {
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.overflow = 'hidden';

    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 800 560');
    svg.style.display = 'block';
    svg.style.background = 'transparent';

    defs = document.createElementNS(NS, 'defs');

    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', 'glow');
    const feGauss = document.createElementNS(NS, 'feGaussianBlur');
    feGauss.setAttribute('stdDeviation', '3');
    feGauss.setAttribute('result', 'coloredBlur');
    filter.appendChild(feGauss);
    const feMerge = document.createElementNS(NS, 'feMerge');
    const feMerge1 = document.createElementNS(NS, 'feMergeNode');
    feMerge1.setAttribute('in', 'coloredBlur');
    const feMerge2 = document.createElementNS(NS, 'feMergeNode');
    feMerge2.setAttribute('in', 'SourceGraphic');
    feMerge.appendChild(feMerge1);
    feMerge.appendChild(feMerge2);
    filter.appendChild(feMerge);
    defs.appendChild(filter);

    const arrowDef = document.createElementNS(NS, 'marker');
    arrowDef.setAttribute('id', 'arrowhead');
    arrowDef.setAttribute('markerWidth', '8');
    arrowDef.setAttribute('markerHeight', '6');
    arrowDef.setAttribute('refX', '8');
    arrowDef.setAttribute('refY', '3');
    arrowDef.setAttribute('orient', 'auto');
    const arrowPath = document.createElementNS(NS, 'path');
    arrowPath.setAttribute('d', 'M0,0 L8,3 L0,6');
    arrowPath.setAttribute('fill', '#4b5563');
    arrowDef.appendChild(arrowPath);
    defs.appendChild(arrowDef);

    svg.appendChild(defs);

    edgesGroup = document.createElementNS(NS, 'g');
    svg.appendChild(edgesGroup);

    particlesGroup = document.createElementNS(NS, 'g');
    svg.appendChild(particlesGroup);

    nodesGroup = document.createElementNS(NS, 'g');
    svg.appendChild(nodesGroup);

    labelsGroup = document.createElementNS(NS, 'g');
    svg.appendChild(labelsGroup);

    container.appendChild(svg);

    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = 'position:absolute;background:rgba(15,15,25,0.95);border:1px solid #333;border-radius:8px;padding:10px 14px;font-size:11px;color:#ccc;pointer-events:none;display:none;z-index:20;line-height:1.6;max-width:220px;';
    container.appendChild(tooltipEl);

    sidePanel = document.createElement('div');
    sidePanel.style.cssText = 'position:absolute;top:0;right:0;width:260px;height:100%;background:rgba(10,10,18,0.92);border-left:1px solid #1f2937;padding:12px;overflow-y:auto;font-size:11px;z-index:10;';

    const panelTitle = document.createElement('div');
    panelTitle.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:10px;';
    panelTitle.textContent = 'Flow Rules Ativas';
    sidePanel.appendChild(panelTitle);

    rulesList = document.createElement('div');
    rulesList.style.cssText = 'margin-bottom:16px;';
    sidePanel.appendChild(rulesList);

    const workerTitle = document.createElement('div');
    workerTitle.style.cssText = 'color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;margin-bottom:8px;';
    workerTitle.textContent = 'Workers';
    sidePanel.appendChild(workerTitle);

    workerTable = document.createElement('div');
    workerTable.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    sidePanel.appendChild(workerTable);

    container.appendChild(sidePanel);
  }

  function createNodeEl(id, label, type, health, metrics) {
    const pos = NODE_POSITIONS[id] || { x: 400, y: 300 };
    const color = HEALTH_COLORS[health] || HEALTH_COLORS.unknown;
    const bg = HEALTH_BG[health] || HEALTH_BG.unknown;

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', pos.x);
    circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', NODE_RADIUS);
    circle.setAttribute('fill', bg);
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '2.5');
    circle.setAttribute('data-node', id);
    circle.style.cursor = 'pointer';
    circle.style.transition = 'stroke 0.3s, fill 0.3s';

    if (type === 'client') {
      circle.setAttribute('stroke-dasharray', '4');
    }

    nodesGroup.appendChild(circle);

    const iconMap = {
      client: '🖥',
      api: '⚡',
      worker: '⚙',
      db: '🗄',
      datadog: '📊',
    };
    const icon = document.createElementNS(NS, 'text');
    icon.setAttribute('x', pos.x);
    icon.setAttribute('y', pos.y + 1);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'central');
    icon.setAttribute('font-size', '16');
    icon.textContent = iconMap[type] || '●';
    nodesGroup.appendChild(icon);

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', pos.x);
    text.setAttribute('y', pos.y + NODE_RADIUS + 16);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#9ca3af');
    text.setAttribute('font-size', '10');
    text.textContent = label;
    labelsGroup.appendChild(text);

    circle.addEventListener('mouseenter', (e) => {
      showTooltip(e, id, label, health, metrics);
    });
    circle.addEventListener('mousemove', (e) => {
      moveTooltip(e);
    });
    circle.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    return { circle, text, icon };
  }

  function createEdgeEl(from, to, rps, blocked, activeRuleId) {
    const fromPos = NODE_POSITIONS[from];
    const toPos = NODE_POSITIONS[to];
    if (!fromPos || !toPos) return null;

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / dist;
    const ny = dy / dist;

    const x1 = fromPos.x + nx * NODE_RADIUS;
    const y1 = fromPos.y + ny * NODE_RADIUS;
    const x2 = toPos.x - nx * NODE_RADIUS;
    const y2 = toPos.y - ny * NODE_RADIUS;

    const maxRps = 20;
    const thickness = Math.max(1, Math.min(6, (rps / maxRps) * 5));
    const color = blocked ? '#ef4444' : (activeRuleId ? '#a855f7' : '#4b5563');
    const opacity = blocked ? 0.6 : (rps > 0 ? 0.8 : 0.2);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', String(thickness));
    line.setAttribute('stroke-opacity', String(opacity));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    line.style.transition = 'stroke-width 0.5s, stroke 0.3s, stroke-opacity 0.5s';

    edgesGroup.appendChild(line);

    return { x1, y1, x2, y2, color, rps, thickness };
  }

  function spawnParticle(edgeData) {
    if (!edgeData || edgeData.rps <= 0) return;
    const p = {
      x: edgeData.x1,
      y: edgeData.y1,
      x1: edgeData.x1,
      y1: edgeData.y1,
      x2: edgeData.x2,
      y2: edgeData.y2,
      progress: Math.random(),
      speed: 0.003 + Math.random() * 0.005,
      color: edgeData.color,
      size: 2 + Math.random() * 2,
    };
    particles.push(p);

    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('r', String(p.size));
    el.setAttribute('fill', p.color);
    el.setAttribute('opacity', '0.7');
    el.setAttribute('filter', 'url(#glow)');
    particlesGroup.appendChild(el);
    p.el = el;
  }

  function animateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.progress += p.speed;
      if (p.progress >= 1) {
        p.el.remove();
        particles.splice(i, 1);
        continue;
      }
      p.x = p.x1 + (p.x2 - p.x1) * p.progress;
      p.y = p.y1 + (p.y2 - p.y1) * p.progress;
      p.el.setAttribute('cx', String(p.x));
      p.el.setAttribute('cy', String(p.y));
      const fade = p.progress < 0.1 ? p.progress * 10 : (p.progress > 0.9 ? (1 - p.progress) * 10 : 1);
      p.el.setAttribute('opacity', String(fade * 0.7));
    }
  }

  function showTooltip(e, id, label, health, metrics) {
    const healthLabels = {
      healthy: 'Saudável',
      degraded: 'Degradado',
      critical: 'Crítico',
      blocked: 'Bloqueado',
      unknown: 'Desconhecido',
    };
    tooltipEl.innerHTML = `
      <div style="color:#e5e7eb;font-weight:bold;margin-bottom:4px;">${label}</div>
      <div style="display:flex;gap:8px;margin-bottom:2px;">
        <span style="color:${HEALTH_COLORS[health] || '#9ca3af'}">●</span>
        <span>${healthLabels[health] || health}</span>
      </div>
      <div>RPS: <span style="color:#e5e7eb">${metrics.rps}</span></div>
      <div>Latência: <span style="color:#e5e7eb">${metrics.avgLatency}ms</span></div>
      <div>Erro: <span style="color:#e5e7eb">${(metrics.errorRate * 100).toFixed(0)}%</span></div>
      <div>Em voo: <span style="color:#e5e7eb">${metrics.inFlight}</span></div>
    `;
    tooltipEl.style.display = 'block';
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const rect = container.getBoundingClientRect();
    let x = e.clientX - rect.left + 14;
    let y = e.clientY - rect.top - 10;
    if (x + 230 > rect.width) x = e.clientX - rect.left - 230;
    if (y + 120 > rect.height) y = rect.height - 130;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }

  function hideTooltip() {
    tooltipEl.style.display = 'none';
  }

  function updateSidePanel(data) {
    if (!data) return;

    if (data.activeRules && data.activeRules.length > 0) {
      rulesList.innerHTML = data.activeRules.map((r) => `
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1f2937;">
          <span style="color:#a855f7">${r.name}</span>
          <span style="color:#6b7280">${r.matchCount}x</span>
        </div>
      `).join('');
    } else {
      rulesList.innerHTML = '<div style="color:#4b5563;padding:4px 0;">Nenhuma regra ativa</div>';
    }

    const workers = (data.nodes || []).filter((n) => n.type === 'worker');
    workerTable.innerHTML = workers.map((w) => {
      const color = HEALTH_COLORS[w.health] || '#9ca3af';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;background:rgba(31,41,55,0.3);border-radius:4px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;"></span>
            <span style="color:#d1d5db">${w.label}</span>
          </div>
          <div style="color:#9ca3af;font-size:10px;">
            ${w.metrics.rps} rps | ${w.metrics.avgLatency}ms | ${(w.metrics.errorRate * 100).toFixed(0)}%
          </div>
        </div>
      `;
    }).join('');
  }

  function render(data) {
    currentData = data;

    edgesGroup.innerHTML = '';
    nodesGroup.innerHTML = '';
    labelsGroup.innerHTML = '';
    particlesGroup.innerHTML = '';
    particles = [];

    const edgeResults = [];
    for (const edge of data.edges || []) {
      const result = createEdgeEl(edge.from, edge.to, edge.rps, edge.blocked, edge.activeRuleId);
      if (result) edgeResults.push(result);
    }

    for (const node of data.nodes || []) {
      createNodeEl(node.id, node.label, node.type, node.health, node.metrics);
    }

    for (const er of edgeResults) {
      const count = Math.max(1, Math.min(4, Math.ceil(er.rps / 3)));
      for (let i = 0; i < count; i++) {
        spawnParticle(er);
      }
    }

    updateSidePanel(data);
  }

  function connectSSE() {
    const eventSource = new EventSource('/api/sdn/topology/events');

    eventSource.addEventListener('topology', (event) => {
      try {
        const data = JSON.parse(event.data);
        render(data);
      } catch (e) {
        console.error('Topology SSE parse error:', e);
      }
    });

    eventSource.addEventListener('error', () => {
      eventSource.close();
      setTimeout(connectSSE, 3000);
    });
  }

  function animate() {
    animateParticles();
    animFrameId = requestAnimationFrame(animate);
  }

  setupUI();

  fetch('/api/sdn/topology')
    .then((r) => r.json())
    .then((data) => render(data))
    .catch(() => {});

  connectSSE();
  animate();
})();
