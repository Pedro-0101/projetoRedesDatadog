import { describe, it, expect } from 'vitest';
import { SCENARIOS, getScenario } from './scenarios';

describe('getScenario', () => {
  it('retorna um cenário conhecido por id', () => {
    expect(getScenario('carga-normal')?.name).toBe('Carga Normal');
  });

  it('retorna undefined para id desconhecido', () => {
    expect(getScenario('nao-existe')).toBeUndefined();
  });

  it('todos os cenários têm os campos obrigatórios', () => {
    for (const s of SCENARIOS) {
      expect(s.id).toBeTruthy();
      expect(typeof s.count).toBe('number');
      expect(typeof s.errorRate).toBe('number');
    }
  });

  it('inclui os 5 cenários novos com behavior', () => {
    expect(getScenario('memory-leak')?.behavior).toBe('mem-leak');
    expect(getScenario('cpu-spike')?.behavior).toBe('cpu-burn');
    expect(getScenario('degradacao-gradual')?.behavior).toBe('degrade');
    expect(getScenario('timeout-cascata')?.behavior).toBe('timeout');
    expect(getScenario('cold-start')?.behavior).toBe('cold-start');
  });
});
