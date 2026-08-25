-- ─────────────────────────────────────────────────────────────────────────────
-- Aura Finanças — schema completo para Postgres
--
-- Substitui o banco do Supabase por um Postgres próprio. Duas diferenças
-- importantes em relação às migrations antigas:
--
--   1. Não existe mais `auth.users`: a tabela de usuários (`app_users`) e as
--      sessões (`user_sessions`) são da própria aplicação.
--   2. Não há RLS. O app conecta como um único usuário do banco, e quem checa
--      papéis (dono / editor / leitor) é a camada de servidor, em
--      `src/integrations/postgres/access.server.ts`.
--
-- Como aplicar (qualquer um dos três):
--
--   1. bun run db:migrate            ← usa a mesma conexão do app
--   2. colar este arquivo inteiro no console SQL do painel
--   3. psql "postgresql://USUARIO:SENHA@HOST:PORTA/BANCO" -v ON_ERROR_STOP=1 -f db/schema.sql
--
-- É SQL puro, sem comandos de cliente: roda igual no psql, no console web do
-- painel e em clientes gráficos. O script é idempotente — pode rodar de novo
-- sem apagar dados.
-- ─────────────────────────────────────────────────────────────────────────────

-- Usa outro schema? Troque `public` nas duas linhas abaixo e em
-- POSTGRES_SCHEMA (.env / painel). Os dois valores precisam ser iguais.
CREATE SCHEMA IF NOT EXISTS public;
SET search_path TO public;

-- gen_random_uuid() é nativa a partir do Postgres 13; em versões anteriores
-- vem da pgcrypto. Um usuário comum não tem permissão de criar extensão, e
-- falhar aqui abortaria o script inteiro — no Postgres 13+ nem é preciso, então
-- a falta de privilégio vira aviso. O bloco EXCEPTION isola isso numa
-- subtransação, sem contaminar o resto do script.
DO $ext$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar a extensão pgcrypto. Tudo bem no Postgres 13+, onde gen_random_uuid() já é nativa.';
END;
$ext$;


-- ─────────────────────────────── utilitários ────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;


-- ───────────────────────── usuários e autenticação ──────────────────────────

-- `email` é sempre gravado em minúsculas pela aplicação; o CHECK garante isso
-- também para inserts feitos direto no banco, e assim o UNIQUE simples já
-- impede dois cadastros que só diferem por maiúsculas.
CREATE TABLE IF NOT EXISTS app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%@%'),
  password_hash text NOT NULL,
  full_name     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por login ativo. Guardamos só o SHA-256 do token que está no
-- cookie: quem lê a tabela não consegue se passar por ninguém.
CREATE TABLE IF NOT EXISTS user_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions(expires_at);


-- ──────────────────────── contas e compartilhamento ─────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#3B82F6',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts(owner_id);

CREATE TABLE IF NOT EXISTS account_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
  email      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS account_members_user_idx ON account_members(user_id);

CREATE TABLE IF NOT EXISTS account_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor','viewer')),
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_invites_token_key ON account_invites(token);
-- Um único convite pendente por e-mail em cada conta. É também o índice usado
-- pelo ON CONFLICT do reconvite, que renova prazo e papel em vez de duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS account_invites_pending_key
  ON account_invites(account_id, lower(email)) WHERE status = 'pending';


-- ───────────────────────── perfis e dados financeiros ───────────────────────

-- Perfis (Pessoal, Empresa, Família…) isolam os dados dentro de uma conta.
CREATE TABLE IF NOT EXISTS budget_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#3B82F6',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budget_profiles_account_idx ON budget_profiles(account_id);

CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense')),
  color       text NOT NULL DEFAULT '#3B82F6',
  emoji       text NOT NULL DEFAULT '💸',
  monthly_cap numeric(14,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_profile_idx ON categories(profile_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
  category_id       uuid REFERENCES categories(id) ON DELETE SET NULL,
  description       text NOT NULL,
  amount            numeric(14,2) NOT NULL,
  kind              text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense')),
  transaction_date  date NOT NULL DEFAULT CURRENT_DATE,
  due_date          date NOT NULL DEFAULT CURRENT_DATE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('paid','pending')),
  installment_no    int,
  installment_total int,
  installment_group uuid,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Cobre os dois filtros de período da tela (por data do lançamento e por
-- vencimento), que é sempre como as transações são consultadas.
CREATE INDEX IF NOT EXISTS transactions_profile_dates_idx
  ON transactions(profile_id, transaction_date, due_date);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category_id);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
  category_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  description  text NOT NULL,
  amount       numeric(14,2) NOT NULL,
  kind         text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense')),
  frequency    text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','weekly','yearly')),
  day_of_month int NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  start_date   date NOT NULL DEFAULT CURRENT_DATE,
  end_date     date,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_rules_profile_idx ON recurring_rules(profile_id);

CREATE TABLE IF NOT EXISTS investments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'Renda Fixa',
  invested_amount numeric(14,2) NOT NULL DEFAULT 0,
  current_amount  numeric(14,2) NOT NULL DEFAULT 0,
  expected_rate   numeric(8,4) NOT NULL DEFAULT 0,
  started_at      date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investments_profile_idx ON investments(profile_id);

CREATE TABLE IF NOT EXISTS goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES budget_profiles(id) ON DELETE CASCADE,
  title          text NOT NULL,
  kind           text NOT NULL DEFAULT 'financial'
                 CHECK (kind IN ('personal','financial','saving','investment')),
  target_amount  numeric(14,2) NOT NULL DEFAULT 0,
  current_amount numeric(14,2) NOT NULL DEFAULT 0,
  target_date    date,
  done           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goals_profile_idx ON goals(profile_id);


-- ─────────────────────────────── triggers ───────────────────────────────────

-- Quem cria a conta entra automaticamente como dono. A aplicação depende
-- disso: `createAccount` só faz o INSERT em `accounts`.
CREATE OR REPLACE FUNCTION add_owner_member() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO account_members (account_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$fn$;

DO $do$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'app_users','accounts','account_members','account_invites','budget_profiles',
      'categories','transactions','recurring_rules','investments','goals'
    ]) AS name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t_%1$s_updated ON %1$I', t.name);
    EXECUTE format(
      'CREATE TRIGGER t_%1$s_updated BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t.name);
  END LOOP;
END;
$do$;

DROP TRIGGER IF EXISTS t_accounts_owner_member ON accounts;
CREATE TRIGGER t_accounts_owner_member AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION add_owner_member();


-- ───────────────────────────── manutenção ───────────────────────────────────

-- Sessões expiradas não atrapalham o login (a query já filtra por
-- `expires_at`), mas acumulam. Rode de tempos em tempos, ou por cron:
--   SELECT purge_expired_sessions();
CREATE OR REPLACE FUNCTION purge_expired_sessions() RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM user_sessions WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$fn$;
