export type Behavior = 'mem-leak' | 'cpu-burn' | 'degrade' | 'cold-start' | 'timeout';

// Headers estáticos por requisição que ativam comportamentos no worker.
// cold-start é armado via POST /reset?cold=N; timeout é tratado no axios (não há header).
export function behaviorHeaders(behavior?: string): Record<string, string> {
  switch (behavior) {
    case 'cpu-burn':
      return { 'X-Cpu-Burn-Ms': '200' };
    case 'mem-leak':
      return { 'X-Mem-Leak-KB': '2048' }; // ~2MB/req => OOM antes de ~256MB
    case 'degrade':
      return { 'X-Degrade': '1' };
    default:
      return {};
  }
}
