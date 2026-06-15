import { describe, it, expect } from 'vitest';
import { ATTACKS, getAttack, SQLI_PAYLOADS, TRAVERSAL_PATHS, COMMON_PASSWORDS } from './attacks';

describe('catálogo de ataques', () => {
  it('contém os 4 ataques', () => {
    expect(ATTACKS.map((a) => a.id).sort()).toEqual([
      'brute-force',
      'exfiltracao',
      'path-traversal',
      'sql-injection',
    ]);
  });

  it('getAttack retorna por id', () => {
    expect(getAttack('sql-injection')?.feature).toBe('ASM');
    expect(getAttack('inexistente')).toBeUndefined();
  });

  it('listas de payload são não-vazias e têm vetores clássicos', () => {
    expect(SQLI_PAYLOADS.some((p) => p.includes("OR '1'='1"))).toBe(true);
    expect(TRAVERSAL_PATHS.some((p) => p.includes('etc/passwd'))).toBe(true);
    expect(COMMON_PASSWORDS).toContain('admin123');
  });
});
