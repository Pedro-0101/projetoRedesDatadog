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
});
