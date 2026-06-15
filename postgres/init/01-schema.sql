CREATE TABLE produtos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  preco NUMERIC(10,2) NOT NULL
);

INSERT INTO produtos (nome, preco) VALUES
  ('Notebook Pro 15', 7999.90),
  ('Mouse Sem Fio', 129.90),
  ('Teclado Mecanico', 349.90),
  ('Monitor 27 4K', 2199.00),
  ('Webcam HD', 259.90),
  ('Headset Gamer', 499.90);

CREATE TABLE vendas (
  id SERIAL PRIMARY KEY,
  produto TEXT,
  valor NUMERIC(10,2),
  cliente TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DEMO: senha em texto plano de propósito (alvo de brute force na Etapa 3).
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL
);

INSERT INTO usuarios (username, senha) VALUES
  ('admin', 'admin123');
