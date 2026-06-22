/*
 * topology/data.js — CAMADA DE DADOS
 * ----------------------------------
 * Abstrai a FONTE de dados da topologia. O resto do app so conhece a funcao
 * `Topo.data.start(onSnapshot)`, que entrega snapshots normalizados no formato:
 *
 *   { timestamp, nodes:[...], edges:[...], activeRules:[...] }
 *
 * onde cada node tem { id,label,type,health,deviceType,ip,mac,
 *                      metrics:{rps,avgLatency,errorRate,inFlight,activeFlows} }
 * e cada edge tem    { from,to,rps,blocked,activeRuleId?,bandwidthMbps,
 *                      utilization,latencyMs,packetLoss,trafficKind }
 *
 * >>> ONDE PLUGAR SUA FONTE REAL <<<
 * Por padrao conectamos no SSE real do SDN (`/api/sdn/topology/events`) + um
 * fetch inicial. Para trocar por WebSocket/polling/outra API, substitua o corpo
 * de `connectLive()`. O gerador mock (toggle no painel de settings) e util para
 * demonstrar o movimento sem trafego real.
 */
(function () {
  const SNAPSHOT_URL = '/api/sdn/topology';
  const SSE_URL = '/api/sdn/topology/events';

  let onSnapshot = null;
  let eventSource = null;
  let mockEnabled = false;
  let mockTimer = null;
  let lastReal = null; // ultimo snapshot real, usado como template do mock

  // ----- Normalizacao (defensiva: garante todos os campos esperados) ---------
  function normalize(raw) {
    if (!raw) return { timestamp: Date.now(), nodes: [], edges: [], activeRules: [] };
    return {
      timestamp: raw.timestamp || new Date().toISOString(),
      nodes: (raw.nodes || []).map((n) => ({
        id: n.id,
        label: n.label || n.id,
        type: n.type || 'host',
        health: n.health || 'unknown',
        deviceType: n.deviceType || n.type || 'host',
        ip: n.ip || null,
        mac: n.mac || null,
        metrics: {
          rps: n.metrics?.rps ?? 0,
          avgLatency: n.metrics?.avgLatency ?? 0,
          errorRate: n.metrics?.errorRate ?? 0,
          inFlight: n.metrics?.inFlight ?? 0,
          activeFlows: n.metrics?.activeFlows ?? n.metrics?.inFlight ?? 0,
        },
      })),
      edges: (raw.edges || []).map((e) => ({
        from: e.from,
        to: e.to,
        rps: e.rps ?? 0,
        blocked: !!e.blocked,
        activeRuleId: e.activeRuleId,
        bandwidthMbps: e.bandwidthMbps ?? 1000,
        utilization: e.utilization ?? 0,
        latencyMs: e.latencyMs ?? 0,
        packetLoss: e.packetLoss ?? 0,
        trafficKind: e.trafficKind || 'normal',
      })),
      activeRules: raw.activeRules || [],
    };
  }

  function emit(raw) {
    const snap = normalize(raw);
    if (!mockEnabled) lastReal = snap;
    if (onSnapshot) onSnapshot(snap);
  }

  // ----- Fonte real: SSE + fetch inicial -------------------------------------
  function connectLive() {
    fetch(SNAPSHOT_URL)
      .then((r) => r.json())
      .then((d) => { if (!mockEnabled) emit(d); })
      .catch(() => {});

    eventSource = new EventSource(SSE_URL);
    eventSource.addEventListener('topology', (event) => {
      if (mockEnabled) return;
      try { emit(JSON.parse(event.data)); } catch (e) { /* ignore */ }
    });
    eventSource.addEventListener('error', () => {
      if (eventSource) eventSource.close();
      eventSource = null;
      setTimeout(() => { if (!mockEnabled) connectLive(); }, 3000);
    });
  }

  // ----- Gerador mock: trafego realista sem backend --------------------------
  // Usa o ultimo snapshot real como template de topologia (ou um default) e
  // anima rps/utilizacao com osciladores suaves por aresta.
  const DEFAULT_TEMPLATE = {
    nodes: [
      { id: 'browser', label: 'Browser', type: 'client', deviceType: 'host' },
      { id: 'api', label: 'api-vendas', type: 'api', deviceType: 'controller' },
      { id: 'worker-a', label: 'worker-a', type: 'worker', deviceType: 'worker' },
      { id: 'worker-b', label: 'worker-b', type: 'worker', deviceType: 'worker' },
      { id: 'worker-c', label: 'worker-c', type: 'worker', deviceType: 'worker' },
      { id: 'postgres', label: 'PostgreSQL', type: 'db', deviceType: 'database' },
      { id: 'datadog', label: 'Datadog Agent', type: 'datadog', deviceType: 'monitor' },
    ],
    edges: [
      { from: 'browser', to: 'api' },
      { from: 'api', to: 'worker-a' },
      { from: 'api', to: 'worker-b' },
      { from: 'api', to: 'worker-c' },
      { from: 'worker-a', to: 'postgres' },
      { from: 'worker-b', to: 'postgres' },
      { from: 'worker-c', to: 'postgres' },
      { from: 'postgres', to: 'datadog' },
    ],
  };

  let mockT = 0;
  function mockSnapshot() {
    const tmpl = lastReal && lastReal.nodes.length ? lastReal : DEFAULT_TEMPLATE;
    mockT += 0.12;

    const edgeRps = {};
    const edges = (tmpl.edges || []).map((e, i) => {
      const control = e.trafficKind === 'control' || (e.from === 'postgres' && e.to === 'datadog');
      const base = control ? 1 : 12 + 8 * Math.sin(mockT + i * 0.9) + 4 * Math.sin(mockT * 0.37 + i);
      const rps = Math.max(0, Math.round(base));
      edgeRps[e.to] = (edgeRps[e.to] || 0) + rps;
      const utilization = Math.min(1, rps / 40);
      const anomalous = !control && Math.sin(mockT * 0.2 + i * 2.1) > 0.85;
      return {
        from: e.from, to: e.to, rps, blocked: false,
        bandwidthMbps: 1000,
        utilization: parseFloat(utilization.toFixed(3)),
        latencyMs: Math.round(40 + 60 * utilization + (anomalous ? 400 : 0)),
        packetLoss: anomalous ? parseFloat((0.05 + Math.random() * 0.1).toFixed(3)) : 0,
        trafficKind: control ? 'control' : anomalous ? 'anomalous' : 'normal',
      };
    });

    const nodes = (tmpl.nodes || []).map((n) => {
      const rps = edgeRps[n.id] || 0;
      const errorRate = parseFloat((Math.max(0, Math.sin(mockT * 0.3 + n.id.length) * 0.08)).toFixed(3));
      return {
        id: n.id, label: n.label || n.id, type: n.type || 'host',
        health: errorRate > 0.05 ? 'degraded' : 'healthy',
        deviceType: n.deviceType || n.type || 'host',
        ip: n.ip || null, mac: n.mac || null,
        metrics: {
          rps, avgLatency: Math.round(60 + rps * 8), errorRate,
          inFlight: Math.round(rps / 3), activeFlows: Math.round(rps / 3),
        },
      };
    });

    return { timestamp: new Date().toISOString(), nodes, edges, activeRules: [] };
  }

  function startMock() {
    stopMock();
    mockTimer = setInterval(() => emit(mockSnapshot()), 1000);
    emit(mockSnapshot());
  }
  function stopMock() {
    if (mockTimer) clearInterval(mockTimer);
    mockTimer = null;
  }

  // ----- API publica ---------------------------------------------------------
  window.Topo = window.Topo || {};
  window.Topo.data = {
    start(cb) {
      onSnapshot = cb;
      connectLive();
    },
    setMock(enabled) {
      mockEnabled = !!enabled;
      if (mockEnabled) startMock();
      else { stopMock(); connectLive(); }
    },
    isMock() { return mockEnabled; },
  };
})();
