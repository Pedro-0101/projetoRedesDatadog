import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app_pw@postgres:5432/vendas',
  max: 10,
});

export async function inserirVenda(produto: string, valor: number, cliente: string): Promise<void> {
  await pool.query(
    'INSERT INTO vendas (produto, valor, cliente) VALUES ($1, $2, $3)',
    [produto, valor, cliente]
  );
}

// DEMO: intencionalmente vulnerável a SQL injection — alvo do ataque na Etapa 3.
export function produtoSearchQuery(q: string): string {
  return `SELECT id, nome, preco FROM produtos WHERE nome ILIKE '%${q}%'`;
}

export async function buscarProdutos(q: string): Promise<unknown[]> {
  const result = await pool.query(produtoSearchQuery(q));
  return result.rows;
}

export { pool };
