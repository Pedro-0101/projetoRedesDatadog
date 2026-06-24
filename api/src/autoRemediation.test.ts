import { describe, it, expect } from 'vitest';
import { parseWorkerFromGroup, planActions, type MonitorGroupState } from './autoRemediation';

describe('parseWorkerFromGroup', () => {
  it('extrai o worker do nome de grupo do monitor', () => {
    expect(parseWorkerFromGroup('worker:worker-a')).toBe('worker-a');
  });

  it('lida com grupos multi-dimensao', () => {
    expect(parseWorkerFromGroup('env:dev,worker:worker-b')).toBe('worker-b');
  });

  it('retorna null para grupos sem dimensao worker', () => {
    expect(parseWorkerFromGroup('*')).toBeNull();
    expect(parseWorkerFromGroup('env:dev')).toBeNull();
  });
});

describe('planActions', () => {
  const groups = (entries: Array<[string, string]>): MonitorGroupState[] =>
    entries.map(([name, status]) => ({ name, status }));

  it('bloqueia worker que entrou em Alert e ainda nao estava bloqueado', () => {
    const { toBlock, toUnblock } = planActions(
      groups([['worker:worker-a', 'Alert'], ['worker:worker-b', 'OK']]),
      new Set()
    );
    expect(toBlock).toEqual(['worker-a']);
    expect(toUnblock).toEqual([]);
  });

  it('nao re-bloqueia worker ja auto-bloqueado', () => {
    const { toBlock } = planActions(
      groups([['worker:worker-a', 'Alert']]),
      new Set(['worker-a'])
    );
    expect(toBlock).toEqual([]);
  });

  it('reativa worker auto-bloqueado que voltou a OK', () => {
    const { toBlock, toUnblock } = planActions(
      groups([['worker:worker-a', 'OK']]),
      new Set(['worker-a'])
    );
    expect(toBlock).toEqual([]);
    expect(toUnblock).toEqual(['worker-a']);
  });

  it('reativa worker auto-bloqueado ausente do estado retornado', () => {
    const { toUnblock } = planActions(groups([]), new Set(['worker-c']));
    expect(toUnblock).toEqual(['worker-c']);
  });

  it('ignora grupos sem dimensao worker (ex.: route-flapping)', () => {
    const { toBlock, toUnblock } = planActions(groups([['*', 'Alert']]), new Set());
    expect(toBlock).toEqual([]);
    expect(toUnblock).toEqual([]);
  });
});
