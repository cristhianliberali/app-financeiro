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

-- Tela em que o app abre para esta pessoa (caminho, ex.: '/tarefas/meu-dia').
-- Nulo mantém o dashboard do Finanças. O conjunto de valores aceitos vive em
-- src/lib/start-route.ts e é validado no servidor antes de gravar.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS start_route text;

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

-- Redefinição de senha por e-mail. Como nas sessões, guardamos só o SHA-256 do
-- token que vai no link: quem lê a tabela não consegue redefinir a senha de
-- ninguém. `consumed_at` marca o link já usado, que não vale uma segunda vez.
CREATE TABLE IF NOT EXISTS password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id, created_at DESC);

-- Troca de e-mail em duas etapas: o código de confirmação é enviado para o
-- endereço NOVO, então só conclui quem realmente recebe lá. `attempts` limita a
-- tentativa de adivinhar o código de 6 dígitos.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  new_email   text NOT NULL CHECK (new_email = lower(new_email) AND new_email LIKE '%@%'),
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_change_requests_user_idx
  ON email_change_requests(user_id, created_at DESC);


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
  color       text NOT NULL DEFAULT '#6366F1',
  -- Nome do ícone no banco de ícones do app (src/lib/icons.tsx). A coluna
  -- nasceu guardando emoji e manteve o nome; a leitura converte os emojis
  -- antigos para o ícone equivalente, então nada precisa ser reescrito aqui.
  emoji       text NOT NULL DEFAULT 'receipt',
  monthly_cap numeric(14,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_profile_idx ON categories(profile_id);

-- Descrição/palavras-chave da categoria. Vai junto na requisição de importação
-- por IA: termos como "IFOOD, RESTAURANTE, PADARIA" ajudam o modelo a
-- classificar as linhas da fatura sem depender só do nome da categoria.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description text;

-- Categoria arquivada em vez de apagada. Apagar de verdade deixaria os
-- lançamentos antigos sem categoria (`ON DELETE SET NULL`) e a categoria
-- sumiria dos relatórios do passado. Arquivar preserva o histórico: o nome
-- continua aparecendo no que já foi lançado, e a categoria só some das listas
-- de escolha de lançamento novo.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- O padrão da marca da categoria passou de emoji para o nome do ícone. Só o
-- DEFAULT muda: as linhas já gravadas continuam com o emoji, que a leitura
-- converte para o ícone equivalente.
ALTER TABLE categories ALTER COLUMN emoji SET DEFAULT 'receipt';

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

-- Até que data as ocorrências desta regra já viraram lançamento. É o que deixa
-- o "para sempre à frente" barato: sem esta coluna, cada leitura de transações
-- teria de recalcular a série inteira da regra desde o começo para descobrir
-- que não há nada novo a criar.
ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS materialized_until date;

-- Recorrência de valor variável: água, luz, cartão. O `amount` da regra deixa
-- de ser o valor e passa a ser a estimativa com que cada ocorrência nasce; o
-- valor de verdade é confirmado uma vez, quando a conta é paga. Sem esta
-- coluna não há como distinguir a conta de luz do aluguel, que é fixo e não
-- deve interromper ninguém com uma pergunta todo mês.
ALTER TABLE recurring_rules
  ADD COLUMN IF NOT EXISTS variable_amount boolean NOT NULL DEFAULT false;

-- De qual regra este lançamento nasceu. `ON DELETE SET NULL` é deliberado: quem
-- decide o destino dos lançamentos ao excluir a regra é a pessoa, na
-- confirmação — o banco não pode apagar histórico financeiro por conta própria.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS recurring_rule_id uuid REFERENCES recurring_rules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_recurring_idx ON transactions(recurring_rule_id);
-- Uma ocorrência por vencimento: é o que torna a geração idempotente, e o que
-- deixa a rotina rodar de novo sem duplicar nada.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_occurrence
  ON transactions(recurring_rule_id, due_date) WHERE recurring_rule_id IS NOT NULL;

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


-- ──────────────────────── tarefas e projetos ────────────────────────────────
--
-- Hierarquia: conta → espaços → quadros → tarefas → subtarefas.
-- Quem pode ver/editar cada nível é decidido em
-- `src/integrations/postgres/tasks.server.ts`, do mesmo jeito que o resto do
-- app — aqui ficam só as regras que são integridade de dado.

CREATE TABLE IF NOT EXISTS spaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  -- Nome do ícone no banco de ícones do app (src/lib/icons.tsx).
  icon        text NOT NULL DEFAULT 'folder',
  color       text NOT NULL DEFAULT '#6366F1',
  created_by  uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS spaces_account_idx ON spaces(account_id);

-- Mesmo caso da categoria: o padrão virou nome de ícone, e os espaços que já
-- existiam seguem com o emoji, traduzido na leitura.
ALTER TABLE spaces ALTER COLUMN icon SET DEFAULT 'folder';

-- Sem nenhuma linha aqui, o espaço é visível para todos os membros da conta.
-- Ao adicionar linhas, o acesso passa a ser restrito a quem está na lista.
CREATE TABLE IF NOT EXISTS space_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user_idx ON space_members(user_id);

CREATE TABLE IF NOT EXISTS boards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id     uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  owner_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  start_date   date,
  due_date     date,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('planning','active','paused','done')),
  default_view text NOT NULL DEFAULT 'kanban'
                 CHECK (default_view IN ('kanban','list','calendar')),
  color        text NOT NULL DEFAULT '#3B82F6',
  created_by   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE INDEX IF NOT EXISTS boards_space_idx ON boards(space_id);

CREATE TABLE IF NOT EXISTS board_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user_idx ON board_members(user_id);

-- Status personalizados por quadro. O nome é livre; `polarity` é o significado
-- interno que dashboards e automações usam para saber se a tarefa está ativa,
-- concluída ou fora do fluxo.
CREATE TABLE IF NOT EXISTS board_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  color      text NOT NULL DEFAULT '#64748B',
  polarity   text NOT NULL DEFAULT 'IN_PROGRESS'
               CHECK (polarity IN ('IN_PROGRESS','SUCCESS','ARCHIVED')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_statuses_board_idx ON board_statuses(board_id, sort_order);

-- Modelos de etapas, por conta.
--
-- Um quadro afinado ("Backlog, A fazer, Em revisão, Concluído") costuma valer
-- para os próximos, e recriá-lo à mão em cada um é trabalho repetido que sai
-- diferente toda vez. O modelo guarda a lista como retrato — jsonb, e não uma
-- tabela filha —, de propósito: mexer no quadro depois não pode reescrever o
-- modelo pelas costas de quem o salvou, nem o contrário.
CREATE TABLE IF NOT EXISTS status_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- [{ name, color, polarity }], na ordem em que as etapas entram no quadro.
  statuses   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);
CREATE INDEX IF NOT EXISTS status_templates_account_idx ON status_templates(account_id);


CREATE TABLE IF NOT EXISTS tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id            uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  status_id           uuid REFERENCES board_statuses(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  responsible_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  -- Urgência da tarefa, independente do status. `none` = sem prioridade definida.
  priority            text NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('urgent','high','normal','low','none')),
  -- Estimativa de esforço em horas; comparada com o tempo real no dashboard.
  estimate_hours      numeric(7,2) CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  start_date          timestamptz,
  due_date            timestamptz,
  sort_order          int NOT NULL DEFAULT 0,
  created_by          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  archived_at         timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_board_idx ON tasks(board_id, sort_order);
CREATE INDEX IF NOT EXISTS tasks_responsible_idx ON tasks(responsible_user_id);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_date);

-- Bancos criados antes de prioridade/estimativa existirem. `ADD COLUMN IF NOT
-- EXISTS` é no-op quando a coluna já veio do CREATE TABLE acima.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_hours numeric(7,2);

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
      CHECK (priority IN ('urgent','high','normal','low','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_estimate_hours_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_estimate_hours_check
      CHECK (estimate_hours IS NULL OR estimate_hours >= 0);
  END IF;
END;
$chk$;

CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks(priority);

CREATE TABLE IF NOT EXISTS task_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS task_participants_user_idx ON task_participants(user_id);

-- Etiquetas são da conta inteira, não do quadro: assim a mesma etiqueta
-- ("Bug", "Cliente A") organiza tarefas de espaços e quadros diferentes, e o
-- filtro por etiqueta funciona nas telas que cruzam vários quadros.
CREATE TABLE IF NOT EXISTS labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#737373',
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS labels_account_idx ON labels(account_id);
-- Nomes de etiqueta são únicos por conta, sem diferenciar maiúsculas: é também
-- o índice usado pelo ON CONFLICT que reaproveita a etiqueta já existente.
CREATE UNIQUE INDEX IF NOT EXISTS labels_account_name_key ON labels(account_id, lower(name));

CREATE TABLE IF NOT EXISTS task_label_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, label_id)
);
CREATE INDEX IF NOT EXISTS task_label_links_label_idx ON task_label_links(label_id);

-- Lembretes. Uma linha por destinatário: quem for avisado recebe a notificação
-- no app quando `remind_at` chega. `delivered_at` marca o que já foi entregue,
-- e é o que impede o mesmo lembrete de aparecer a cada recarga da página.
CREATE TABLE IF NOT EXISTS task_reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  remind_at    timestamptz NOT NULL,
  note         text,
  delivered_at timestamptz,
  created_by   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_reminders_task_idx ON task_reminders(task_id, remind_at);
-- A consulta quente é "o que já venceu e ainda não entreguei para este usuário".
CREATE INDEX IF NOT EXISTS task_reminders_pending_idx
  ON task_reminders(user_id, remind_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS subtasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title               text NOT NULL,
  responsible_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  start_date          timestamptz,
  due_date            timestamptz,
  completed           boolean NOT NULL DEFAULT false,
  completed_at        timestamptz,
  sort_order          int NOT NULL DEFAULT 0,
  created_by          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks(task_id, sort_order);
CREATE INDEX IF NOT EXISTS subtasks_due_idx ON subtasks(due_date);

-- Anexos da tarefa. O arquivo vive no bucket S3 (ou compatível); aqui ficam só
-- os metadados e a chave do objeto. O navegador nunca recebe credencial: lê e
-- escreve por URL assinada com prazo, gerada em
-- `src/integrations/storage/s3.server.ts`.
CREATE TABLE IF NOT EXISTS task_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- Chave do objeto no bucket. Única: dois envios nunca se sobrepõem.
  object_key   text NOT NULL UNIQUE,
  file_name    text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  uploaded_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments(task_id, created_at DESC);

-- `stopped_at IS NULL` significa cronômetro em execução.
CREATE TABLE IF NOT EXISTS time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL DEFAULT now(),
  stopped_at       timestamptz,
  duration_seconds int,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
CREATE INDEX IF NOT EXISTS time_entries_task_idx ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS time_entries_user_idx ON time_entries(user_id, started_at);
-- Impede registros inconsistentes: no máximo um cronômetro ativo por usuário.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_single_running
  ON time_entries(user_id) WHERE stopped_at IS NULL;

-- ─────────────────────── integração com o Google Agenda ─────────────────────
--
-- A conexão é por usuário: cada um autoriza o app no seu Google, e a tarefa vai
-- para a agenda de quem é responsável por ela. Sem responsável conectado, não
-- há evento — é o que mantém a agenda de cada um sendo a sua.

CREATE TABLE IF NOT EXISTS google_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  google_email  text NOT NULL,
  -- Agenda de destino. "primary" é a principal da conta.
  calendar_id   text NOT NULL DEFAULT 'primary',
  -- Tokens cifrados pela aplicação (AES-256-GCM). O banco nunca guarda o valor
  -- em claro: um dump não dá acesso à agenda de ninguém.
  access_token  text,
  refresh_token text NOT NULL,
  expires_at    timestamptz,
  -- Marcador do Google para buscar só o que mudou desde a última sincronização.
  sync_token    text,
  last_sync_at  timestamptz,
  -- Última falha, para a tela explicar por que parou (token revogado, cota…).
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Liga a tarefa ao evento criado na agenda de um usuário. Uma tarefa pode ter,
-- no máximo, um evento por pessoa — hoje só o responsável.
CREATE TABLE IF NOT EXISTS task_calendar_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_id    text NOT NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  synced_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS task_calendar_events_event_idx ON task_calendar_events(event_id);
CREATE INDEX IF NOT EXISTS task_calendar_events_user_idx ON task_calendar_events(user_id);


-- Trilha de auditoria da tarefa, escrita pela camada de servidor (que é quem
-- sabe qual usuário está por trás da requisição).
CREATE TABLE IF NOT EXISTS task_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity(task_id, created_at DESC);


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
      'categories','transactions','recurring_rules','investments','goals',
      'spaces','boards','board_statuses','tasks','subtasks','time_entries',
      'labels','task_reminders','google_accounts'
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

-- A polaridade do status é quem decide se a tarefa está concluída ou
-- arquivada: o app pode renomear os status à vontade sem perder essa noção.
CREATE OR REPLACE FUNCTION sync_task_completion() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  task_polarity text;
BEGIN
  SELECT polarity INTO task_polarity FROM board_statuses WHERE id = NEW.status_id;
  IF task_polarity = 'SUCCESS' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.archived_at := NULL;
  ELSIF task_polarity = 'ARCHIVED' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
    NEW.completed_at := NULL;
  ELSE
    NEW.completed_at := NULL;
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS t_tasks_completion ON tasks;
CREATE TRIGGER t_tasks_completion BEFORE INSERT OR UPDATE OF status_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_completion();

CREATE OR REPLACE FUNCTION sync_subtask_completion() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.completed THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS t_subtasks_completion ON subtasks;
CREATE TRIGGER t_subtasks_completion BEFORE INSERT OR UPDATE OF completed ON subtasks
  FOR EACH ROW EXECUTE FUNCTION sync_subtask_completion();

-- A duração sai sempre do par started_at/stopped_at, nunca do cliente.
CREATE OR REPLACE FUNCTION sync_time_entry_duration() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.stopped_at IS NULL THEN
    NEW.duration_seconds := NULL;
  ELSE
    NEW.duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.stopped_at - NEW.started_at))::int);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS t_time_entries_duration ON time_entries;
CREATE TRIGGER t_time_entries_duration BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION sync_time_entry_duration();


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
  -- Tokens de redefinição e códigos de troca de e-mail vencem sozinhos (a
  -- consulta filtra por `expires_at`), mas também não precisam ficar guardados.
  DELETE FROM password_resets WHERE expires_at < now() - interval '7 days';
  DELETE FROM email_change_requests WHERE expires_at < now() - interval '7 days';
  RETURN removed;
END;
$fn$;

-- ─────────────────────── cache de merchants (importação) ────────────────────

-- Descritor cru de fatura -> nome de categoria. Global, e não por usuário:
-- "MERCADOLIVRE*", "APPLE.COM/BILL" e "DM *Spotify" valem para a base inteira,
-- e é este cache que faz a categorização por IA custar cada vez menos — só
-- descritor inédito vira requisição. Rótulo confirmado por pessoa
-- (origem = 'usuario') nunca é sobrescrito por palpite de modelo.
CREATE TABLE IF NOT EXISTS merchant_labels (
  chave      text PRIMARY KEY,
  categoria  text NOT NULL,
  confianca  numeric(4,3) NOT NULL DEFAULT 1,
  origem     text NOT NULL DEFAULT 'ia' CHECK (origem IN ('ia','usuario')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
