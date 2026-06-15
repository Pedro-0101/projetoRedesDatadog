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
}

export interface TestParams {
  scenario?: string;
  count: number;
  errorRate: number;
  minDelay: number;
  maxDelay: number;
  concurrency: number;
  cascading: boolean;
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
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
