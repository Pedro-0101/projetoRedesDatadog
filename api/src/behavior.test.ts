import { describe, it, expect } from 'vitest';
import { behaviorHeaders } from './behavior';

describe('behaviorHeaders', () => {
  it('cpu-burn → X-Cpu-Burn-Ms', () => {
    expect(behaviorHeaders('cpu-burn')).toEqual({ 'X-Cpu-Burn-Ms': '200' });
  });
  it('mem-leak → X-Mem-Leak-KB', () => {
    expect(behaviorHeaders('mem-leak')).toEqual({ 'X-Mem-Leak-KB': '2048' });
  });
  it('degrade → X-Degrade', () => {
    expect(behaviorHeaders('degrade')).toEqual({ 'X-Degrade': '1' });
  });
  it('cold-start e timeout não geram headers de worker', () => {
    expect(behaviorHeaders('cold-start')).toEqual({});
    expect(behaviorHeaders('timeout')).toEqual({});
  });
  it('undefined → vazio', () => {
    expect(behaviorHeaders(undefined)).toEqual({});
  });
});
