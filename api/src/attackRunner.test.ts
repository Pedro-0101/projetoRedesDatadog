import { describe, it, expect } from 'vitest';
import { buildAttackRequest } from './attackRunner';

describe('buildAttackRequest', () => {
  it('sql-injection usa GET em /api/produtos/buscar', () => {
    const r = buildAttackRequest('sql-injection', 0);
    expect(r.method).toBe('get');
    expect(r.url).toContain('/api/produtos/buscar?q=');
  });

  it('path-traversal mira /api/arquivos', () => {
    expect(buildAttackRequest('path-traversal', 0).url).toContain('/api/arquivos?path=');
  });

  it('brute-force faz POST em /api/login com admin', () => {
    const r = buildAttackRequest('brute-force', 0);
    expect(r.method).toBe('post');
    expect(r.url).toContain('/api/login');
    expect((r.data as { username: string }).username).toBe('admin');
  });

  it('exfiltracao cresce o size a cada índice', () => {
    expect(buildAttackRequest('exfiltracao', 4).url).toContain('size=500');
  });
});
