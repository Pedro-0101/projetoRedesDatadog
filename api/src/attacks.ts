export interface Attack {
  id: string;
  name: string;
  description: string;
  narrative: string;
  feature: string;
  defaultCount: number;
  defaultConcurrency: number;
}

export const ATTACKS: Attack[] = [
  {
    id: 'sql-injection',
    name: 'SQL Injection',
    description: 'Injeta payloads SQL no campo de busca de produtos',
    narrative: 'Um atacante tenta extrair dados da tabela de usuários via busca.',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 5,
  },
  {
    id: 'path-traversal',
    name: 'Path Traversal / Scan',
    description: 'Tenta ler arquivos fora do diretório e varre rotas comuns',
    narrative: 'Um scanner automático procura arquivos sensíveis (.env, /etc/passwd).',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 5,
  },
  {
    id: 'brute-force',
    name: 'Brute Force de Login',
    description: 'Martela /api/login com senhas comuns contra admin',
    narrative: 'Tentativa de adivinhar a senha do admin por força bruta.',
    feature: 'ASM',
    defaultCount: 40,
    defaultConcurrency: 8,
  },
  {
    id: 'exfiltracao',
    name: 'Exfiltração de Dados',
    description: 'Requisita exports cada vez maiores (padrão de exfiltração)',
    narrative: 'Saída de dados crescente simulando vazamento.',
    feature: 'ASM / Signals',
    defaultCount: 30,
    defaultConcurrency: 4,
  },
];

export function getAttack(id: string): Attack | undefined {
  return ATTACKS.find((a) => a.id === id);
}

export const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE vendas; --",
  "' UNION SELECT username, senha, 1 FROM usuarios --",
  "admin'--",
  "' OR 1=1 --",
];

export const TRAVERSAL_PATHS = [
  '../../../../etc/passwd',
  '....//....//etc/hosts',
  '/.env',
  '/admin',
  '/wp-login.php',
  '../../config',
];

export const COMMON_PASSWORDS = [
  '123456',
  'password',
  'admin',
  'root',
  'qwerty',
  'letmein',
  'senha',
  'admin123',
];
