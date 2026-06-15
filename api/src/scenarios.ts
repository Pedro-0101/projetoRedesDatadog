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
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
