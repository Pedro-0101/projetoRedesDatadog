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

export async function buscarUsuario(
  username: string
): Promise<{ username: string; senha: string } | null> {
  const result = await pool.query(
    'SELECT username, senha FROM usuarios WHERE username = $1',
    [username]
  );
  return result.rows[0] ?? null;
}

export { pool };
