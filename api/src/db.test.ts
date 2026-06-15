import { describe, it, expect } from 'vitest';
import { produtoSearchQuery } from './db';

describe('produtoSearchQuery', () => {
  it('concatena o termo diretamente (vulnerável por design)', () => {
    expect(produtoSearchQuery('mouse')).toBe(
      "SELECT id, nome, preco FROM produtos WHERE nome ILIKE '%mouse%'"
    );
  });

  it('não escapa aspas — permite injeção (comportamento esperado da demo)', () => {
    expect(produtoSearchQuery("' OR '1'='1")).toContain("' OR '1'='1");
  });
});
