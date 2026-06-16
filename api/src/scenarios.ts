export interface Scenario {
  id: string;
  name: string;
  description: string;
  count: number;
  errorRate: number;
  minDelay: number;
  maxDelay: number;
  concurrency: number;
  cascading: boolean;
  behavior?: string;
  priority?: string;
}

export interface SdnScenarioMeta {
  targetWorker?: string;
  blockWorker?: string;
}

export interface TestParams {
  scenario?: string;
  count: number;
  errorRate: number;
  minDelay: number;
  maxDelay: number;
  concurrency: number;
  cascading: boolean;
  behavior?: string;
  priority?: string;
  sdn?: SdnScenarioMeta;
}

export interface TestState {
  testId: string;
  params: TestParams;
  scenarioId: string;
  startedAt: number;
  total: number;
  sent: number;
  success: number;
  errors: number;
  inFlight: number;
  latencies: number[];
  cancelled: boolean;
  finished: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'carga-normal',
    name: 'Carga Normal',
    description: '100 requisicoes com baixa taxa de erro',
    count: 100,
    errorRate: 0.05,
    minDelay: 100,
    maxDelay: 500,
    concurrency: 10,
    cascading: false,
  },
  {
    id: 'tempestade-erros',
    name: 'Tempestade de Erros',
    description: '50 requisicoes com 80% de falha',
    count: 50,
    errorRate: 0.8,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 20,
    cascading: false,
  },
  {
    id: 'pico-latencia',
    name: 'Pico de Latencia',
    description: '20 requisicoes lentas sem erros',
    count: 20,
    errorRate: 0.0,
    minDelay: 3000,
    maxDelay: 8000,
    concurrency: 3,
    cascading: false,
  },
  {
    id: 'rajada-trafego',
    name: 'Rajada de Trafego',
    description: '500 requisicoes de alta velocidade',
    count: 500,
    errorRate: 0.1,
    minDelay: 50,
    maxDelay: 200,
    concurrency: 50,
    cascading: false,
  },
  {
    id: 'falha-cascata',
    name: 'Falha em Cascata',
    description: 'Taxa de erro escala de 5% a 95%',
    count: 100,
    errorRate: 0.05,
    minDelay: 100,
    maxDelay: 500,
    concurrency: 10,
    cascading: true,
  },
  {
    id: 'memory-leak',
    name: 'Memory Leak',
    description: '200 requisicoes; worker acumula memoria ate estourar',
    count: 200,
    errorRate: 0.0,
    minDelay: 50,
    maxDelay: 150,
    concurrency: 10,
    cascading: false,
    behavior: 'mem-leak',
  },
  {
    id: 'cpu-spike',
    name: 'Pico de CPU',
    description: '100 requisicoes que queimam CPU (flame graph no Profiler)',
    count: 100,
    errorRate: 0.0,
    minDelay: 50,
    maxDelay: 100,
    concurrency: 8,
    cascading: false,
    behavior: 'cpu-burn',
  },
  {
    id: 'degradacao-gradual',
    name: 'Degradacao Gradual',
    description: 'Latencia cresce a cada requisicao ao longo do teste',
    count: 200,
    errorRate: 0.02,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 5,
    cascading: false,
    behavior: 'degrade',
  },
  {
    id: 'timeout-cascata',
    name: 'Timeout em Cascata',
    description: 'Worker lento + timeout curto na API => falhas em cascata',
    count: 100,
    errorRate: 0.0,
    minDelay: 2000,
    maxDelay: 5000,
    concurrency: 20,
    cascading: false,
    behavior: 'timeout',
  },
  {
    id: 'cold-start',
    name: 'Cold Start',
    description: 'Primeiras requisicoes lentas (warmup), depois normaliza',
    count: 50,
    errorRate: 0.0,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 5,
    cascading: false,
    behavior: 'cold-start',
  },
  {
    id: 'sdn-congestion',
    name: 'SDN Congestion',
    description: '100 reqs com cpu-burn no worker-a; SDN migra trafego automaticamente',
    count: 100,
    errorRate: 0.0,
    minDelay: 50,
    maxDelay: 100,
    concurrency: 8,
    cascading: false,
    behavior: 'cpu-burn',
  },
  {
    id: 'sdn-route-failure',
    name: 'SDN Route Failure',
    description: 'Bloqueia worker-b no meio do teste e observa failover',
    count: 100,
    errorRate: 0.05,
    minDelay: 50,
    maxDelay: 200,
    concurrency: 10,
    cascading: false,
  },
  {
    id: 'sdn-balanced',
    name: 'SDN Balanced',
    description: '300 requisicoes normais distribuidas ~33% por worker',
    count: 300,
    errorRate: 0.05,
    minDelay: 50,
    maxDelay: 150,
    concurrency: 20,
    cascading: false,
  },
  {
    id: 'sdn-recovery',
    name: 'SDN Recovery',
    description: 'Degrada worker-a, depois recupera e ve rebalanceamento',
    count: 200,
    errorRate: 0.1,
    minDelay: 100,
    maxDelay: 300,
    concurrency: 8,
    cascading: false,
    behavior: 'degrade',
  },
  {
    id: 'qos-mixed-load',
    name: 'QoS Mixed Load',
    description: '200 reqs — 50% gold, 30% silver, 20% bronze',
    count: 200,
    errorRate: 0.05,
    minDelay: 50,
    maxDelay: 200,
    concurrency: 20,
    cascading: false,
    priority: 'mixed',
  },
  {
    id: 'qos-bronze-storm',
    name: 'QoS Bronze Storm',
    description: '300 reqs bronze com alta concorrencia para testar throttling',
    count: 300,
    errorRate: 0.1,
    minDelay: 30,
    maxDelay: 100,
    concurrency: 50,
    cascading: false,
    priority: 'bronze',
  },
  {
    id: 'qos-priority-proof',
    name: 'QoS Priority Proof',
    description: '100 gold + 200 bronze simultaneos; gold nao deve sofrer throttling',
    count: 300,
    errorRate: 0.05,
    minDelay: 50,
    maxDelay: 150,
    concurrency: 30,
    cascading: false,
    priority: 'mixed',
  },
  {
    id: 'shaping-burst-off',
    name: 'Shaping Burst OFF',
    description: '400 req em 5s sem token bucket — latencia caotica (desative shaping antes)',
    count: 400,
    errorRate: 0.05,
    minDelay: 5,
    maxDelay: 20,
    concurrency: 50,
    cascading: false,
  },
  {
    id: 'shaping-burst-on',
    name: 'Shaping Burst ON',
    description: '400 req em 5s com token bucket — throughput limitado mas suave (ative shaping antes)',
    count: 400,
    errorRate: 0.05,
    minDelay: 5,
    maxDelay: 20,
    concurrency: 50,
    cascading: false,
  },
  {
    id: 'shaping-recovery',
    name: 'Shaping Recovery',
    description: 'Burst esgota o bucket, depois trafego normal — ve recuperacao dos tokens',
    count: 500,
    errorRate: 0.05,
    minDelay: 10,
    maxDelay: 100,
    concurrency: 40,
    cascading: false,
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
