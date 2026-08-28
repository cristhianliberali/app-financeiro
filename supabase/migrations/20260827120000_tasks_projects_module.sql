-- =====================================================================
-- Módulo: Tarefas e Projetos
-- Hierarquia: conta -> espaços -> quadros -> tarefas -> subtarefas
-- Paralelamente: quadros -> status personalizados -> polaridade
--                tarefas -> registros de tempo / histórico
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) TABELAS
-- ---------------------------------------------------------------------

CREATE TABLE public.spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT '📁',
  color text NOT NULL DEFAULT '#3B82F6',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX spaces_account_idx ON public.spaces(account_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated;
GRANT ALL ON public.spaces TO service_role;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

-- Quando um espaço não possui nenhuma linha aqui, todos os membros da conta
-- enxergam o espaço. Ao adicionar linhas, o acesso passa a ser restrito.
CREATE TABLE public.space_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);
CREATE INDEX space_members_user_idx ON public.space_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_members TO authenticated;
GRANT ALL ON public.space_members TO service_role;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date date,
  due_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planning','active','paused','done')),
  default_view text NOT NULL DEFAULT 'kanban' CHECK (default_view IN ('kanban','list','calendar')),
  color text NOT NULL DEFAULT '#3B82F6',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX boards_space_idx ON public.boards(space_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boards TO authenticated;
GRANT ALL ON public.boards TO service_role;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.board_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, user_id)
);
CREATE INDEX board_members_user_idx ON public.board_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_members TO authenticated;
GRANT ALL ON public.board_members TO service_role;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

-- Status personalizados por quadro. A polaridade é o significado interno
-- usado por métricas, dashboards e automações.
CREATE TABLE public.board_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#64748B',
  polarity text NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (polarity IN ('IN_PROGRESS','SUCCESS','ARCHIVED')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_statuses_board_idx ON public.board_statuses(board_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_statuses TO authenticated;
GRANT ALL ON public.board_statuses TO service_role;
ALTER TABLE public.board_statuses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  status_id uuid REFERENCES public.board_statuses(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date timestamptz,
  due_date timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  archived_at timestamptz
);
CREATE INDEX tasks_board_idx ON public.tasks(board_id, sort_order);
CREATE INDEX tasks_responsible_idx ON public.tasks(responsible_user_id);
CREATE INDEX tasks_due_idx ON public.tasks(due_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.task_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);
CREATE INDEX task_participants_user_idx ON public.task_participants(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_participants TO authenticated;
GRANT ALL ON public.task_participants TO service_role;
ALTER TABLE public.task_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date timestamptz,
  due_date timestamptz,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subtasks_task_idx ON public.subtasks(task_id, sort_order);
CREATE INDEX subtasks_due_idx ON public.subtasks(due_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subtasks TO authenticated;
GRANT ALL ON public.subtasks TO service_role;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

-- stopped_at IS NULL => cronômetro em execução
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  duration_seconds int,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
CREATE INDEX time_entries_task_idx ON public.time_entries(task_id);
CREATE INDEX time_entries_user_idx ON public.time_entries(user_id, started_at);
-- Impede registros inconsistentes: no máximo um cronômetro ativo por usuário.
CREATE UNIQUE INDEX time_entries_single_running ON public.time_entries(user_id) WHERE stopped_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Trilha de auditoria da tarefa (alimentada por triggers).
CREATE TABLE public.task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_activity_task_idx ON public.task_activity(task_id, created_at DESC);
GRANT SELECT ON public.task_activity TO authenticated;
GRANT ALL ON public.task_activity TO service_role;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2) FUNÇÕES DE ACESSO
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.space_account(_space_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM public.spaces WHERE id = _space_id
$$;

CREATE OR REPLACE FUNCTION public.can_view_space(_space_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_account_member(public.space_account(_space_id))
     AND (
       NOT EXISTS (SELECT 1 FROM public.space_members WHERE space_id = _space_id)
       OR EXISTS (SELECT 1 FROM public.space_members WHERE space_id = _space_id AND user_id = auth.uid())
       OR EXISTS (SELECT 1 FROM public.spaces WHERE id = _space_id AND created_by = auth.uid())
     )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_space(_space_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_account(public.space_account(_space_id)) AND public.can_view_space(_space_id)
$$;

CREATE OR REPLACE FUNCTION public.board_space(_board_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT space_id FROM public.boards WHERE id = _board_id
$$;

CREATE OR REPLACE FUNCTION public.can_view_board(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_space(public.board_space(_board_id))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_board(_board_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_space(public.board_space(_board_id))
$$;

CREATE OR REPLACE FUNCTION public.task_board(_task_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT board_id FROM public.tasks WHERE id = _task_id
$$;

CREATE OR REPLACE FUNCTION public.can_view_task(_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_view_board(public.task_board(_task_id))
$$;

CREATE OR REPLACE FUNCTION public.can_edit_task(_task_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_board(public.task_board(_task_id))
$$;

CREATE OR REPLACE FUNCTION public.status_board(_status_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT board_id FROM public.board_statuses WHERE id = _status_id
$$;

-- ---------------------------------------------------------------------
-- 3) POLICIES
-- ---------------------------------------------------------------------

CREATE POLICY "read spaces" ON public.spaces FOR SELECT TO authenticated
  USING (public.can_view_space(id));
CREATE POLICY "create spaces" ON public.spaces FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_account(account_id) AND created_by = auth.uid());
CREATE POLICY "update spaces" ON public.spaces FOR UPDATE TO authenticated
  USING (public.can_edit_space(id)) WITH CHECK (public.can_edit_space(id));
CREATE POLICY "delete spaces" ON public.spaces FOR DELETE TO authenticated
  USING (public.can_edit_space(id));

CREATE POLICY "read space_members" ON public.space_members FOR SELECT TO authenticated
  USING (public.is_account_member(public.space_account(space_id)));
CREATE POLICY "write space_members" ON public.space_members FOR ALL TO authenticated
  USING (public.can_edit_account(public.space_account(space_id)))
  WITH CHECK (public.can_edit_account(public.space_account(space_id)));

CREATE POLICY "read boards" ON public.boards FOR SELECT TO authenticated
  USING (public.can_view_space(space_id));
CREATE POLICY "create boards" ON public.boards FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_space(space_id) AND created_by = auth.uid());
CREATE POLICY "update boards" ON public.boards FOR UPDATE TO authenticated
  USING (public.can_edit_space(space_id)) WITH CHECK (public.can_edit_space(space_id));
CREATE POLICY "delete boards" ON public.boards FOR DELETE TO authenticated
  USING (public.can_edit_space(space_id));

CREATE POLICY "read board_members" ON public.board_members FOR SELECT TO authenticated
  USING (public.can_view_board(board_id));
CREATE POLICY "write board_members" ON public.board_members FOR ALL TO authenticated
  USING (public.can_edit_board(board_id)) WITH CHECK (public.can_edit_board(board_id));

CREATE POLICY "read board_statuses" ON public.board_statuses FOR SELECT TO authenticated
  USING (public.can_view_board(board_id));
CREATE POLICY "write board_statuses" ON public.board_statuses FOR ALL TO authenticated
  USING (public.can_edit_board(board_id)) WITH CHECK (public.can_edit_board(board_id));

CREATE POLICY "read tasks" ON public.tasks FOR SELECT TO authenticated
  USING (public.can_view_board(board_id));
CREATE POLICY "create tasks" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_board(board_id) AND created_by = auth.uid());
CREATE POLICY "update tasks" ON public.tasks FOR UPDATE TO authenticated
  USING (public.can_edit_board(board_id)) WITH CHECK (public.can_edit_board(board_id));
CREATE POLICY "delete tasks" ON public.tasks FOR DELETE TO authenticated
  USING (public.can_edit_board(board_id));

CREATE POLICY "read task_participants" ON public.task_participants FOR SELECT TO authenticated
  USING (public.can_view_task(task_id));
CREATE POLICY "write task_participants" ON public.task_participants FOR ALL TO authenticated
  USING (public.can_edit_task(task_id)) WITH CHECK (public.can_edit_task(task_id));

CREATE POLICY "read subtasks" ON public.subtasks FOR SELECT TO authenticated
  USING (public.can_view_task(task_id));
CREATE POLICY "create subtasks" ON public.subtasks FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_task(task_id) AND created_by = auth.uid());
CREATE POLICY "update subtasks" ON public.subtasks FOR UPDATE TO authenticated
  USING (public.can_edit_task(task_id)) WITH CHECK (public.can_edit_task(task_id));
CREATE POLICY "delete subtasks" ON public.subtasks FOR DELETE TO authenticated
  USING (public.can_edit_task(task_id));

-- Registros de tempo são pessoais para escrita; membros do quadro leem tudo
-- (necessário para os relatórios de produtividade por usuário).
CREATE POLICY "read time_entries" ON public.time_entries FOR SELECT TO authenticated
  USING (public.can_view_task(task_id));
CREATE POLICY "create own time_entries" ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_task(task_id));
CREATE POLICY "update own time_entries" ON public.time_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own time_entries" ON public.time_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_task(task_id));

CREATE POLICY "read task_activity" ON public.task_activity FOR SELECT TO authenticated
  USING (public.can_view_task(task_id));

-- ---------------------------------------------------------------------
-- 4) TRIGGERS DE MANUTENÇÃO
-- ---------------------------------------------------------------------

CREATE TRIGGER t_spaces_updated BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_boards_updated BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_board_statuses_updated BEFORE UPDATE ON public.board_statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_tasks_updated BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_subtasks_updated BEFORE UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_time_entries_updated BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A polaridade do status decide se a tarefa está concluída ou arquivada.
CREATE OR REPLACE FUNCTION public.sync_task_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _polarity text;
BEGIN
  SELECT polarity INTO _polarity FROM public.board_statuses WHERE id = NEW.status_id;
  IF _polarity = 'SUCCESS' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.archived_at := NULL;
  ELSIF _polarity = 'ARCHIVED' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
    NEW.completed_at := NULL;
  ELSE
    NEW.completed_at := NULL;
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_tasks_completion BEFORE INSERT OR UPDATE OF status_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_completion();

CREATE OR REPLACE FUNCTION public.sync_subtask_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.completed THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_subtasks_completion BEFORE INSERT OR UPDATE OF completed ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_subtask_completion();

CREATE OR REPLACE FUNCTION public.sync_time_entry_duration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stopped_at IS NULL THEN
    NEW.duration_seconds := NULL;
  ELSE
    NEW.duration_seconds := GREATEST(0, EXTRACT(EPOCH FROM (NEW.stopped_at - NEW.started_at))::int);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_time_entries_duration BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_time_entry_duration();

-- ---------------------------------------------------------------------
-- 5) HISTÓRICO DA TAREFA
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_task_activity(
  _task_id uuid, _action text, _meta jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.task_activity (task_id, user_id, action, meta)
  VALUES (_task_id, auth.uid(), _action, COALESCE(_meta, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.track_task_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _from text; _to text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_task_activity(NEW.id, 'task_created', jsonb_build_object('title', NEW.title));
    RETURN NEW;
  END IF;

  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT name INTO _from FROM public.board_statuses WHERE id = OLD.status_id;
    SELECT name INTO _to FROM public.board_statuses WHERE id = NEW.status_id;
    PERFORM public.log_task_activity(NEW.id, 'status_changed',
      jsonb_build_object('from', _from, 'to', _to));
    IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
      PERFORM public.log_task_activity(NEW.id, 'task_completed', '{}'::jsonb);
    END IF;
    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
      PERFORM public.log_task_activity(NEW.id, 'task_archived', '{}'::jsonb);
    END IF;
  END IF;

  IF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
    PERFORM public.log_task_activity(NEW.id, 'responsible_changed',
      jsonb_build_object('user_id', NEW.responsible_user_id));
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    PERFORM public.log_task_activity(NEW.id, 'due_date_changed',
      jsonb_build_object('from', OLD.due_date, 'to', NEW.due_date));
  END IF;

  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    PERFORM public.log_task_activity(NEW.id, 'start_date_changed',
      jsonb_build_object('from', OLD.start_date, 'to', NEW.start_date));
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM public.log_task_activity(NEW.id, 'title_changed',
      jsonb_build_object('from', OLD.title, 'to', NEW.title));
  END IF;

  RETURN NEW;
END; $$;
CREATE TRIGGER t_tasks_activity AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.track_task_changes();

CREATE OR REPLACE FUNCTION public.track_participant_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_task_activity(NEW.task_id, 'participant_added',
      jsonb_build_object('user_id', NEW.user_id));
    RETURN NEW;
  END IF;
  PERFORM public.log_task_activity(OLD.task_id, 'participant_removed',
    jsonb_build_object('user_id', OLD.user_id));
  RETURN OLD;
END; $$;
CREATE TRIGGER t_task_participants_activity AFTER INSERT OR DELETE ON public.task_participants
  FOR EACH ROW EXECUTE FUNCTION public.track_participant_changes();

CREATE OR REPLACE FUNCTION public.track_subtask_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_task_activity(NEW.task_id, 'subtask_created',
      jsonb_build_object('title', NEW.title));
    RETURN NEW;
  END IF;
  IF NEW.completed IS DISTINCT FROM OLD.completed THEN
    PERFORM public.log_task_activity(NEW.task_id,
      CASE WHEN NEW.completed THEN 'subtask_completed' ELSE 'subtask_reopened' END,
      jsonb_build_object('title', NEW.title));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_subtasks_activity AFTER INSERT OR UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.track_subtask_changes();

CREATE OR REPLACE FUNCTION public.track_time_entry_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.stopped_at IS NULL THEN
    PERFORM public.log_task_activity(NEW.task_id, 'timer_started', '{}'::jsonb);
  ELSIF NEW.stopped_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.stopped_at IS NULL) THEN
    PERFORM public.log_task_activity(NEW.task_id, 'time_logged',
      jsonb_build_object('duration_seconds', NEW.duration_seconds));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_time_entries_activity AFTER INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.track_time_entry_changes();

-- ---------------------------------------------------------------------
-- 6) RPCs
-- ---------------------------------------------------------------------

-- Diretório de usuários da conta (nome/e-mail) para responsáveis e participantes.
CREATE OR REPLACE FUNCTION public.account_users(_account_id uuid)
RETURNS TABLE(user_id uuid, email text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id,
         COALESCE(m.email, u.email) AS email,
         COALESCE(
           NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
           NULLIF(u.raw_user_meta_data ->> 'name', ''),
           split_part(COALESCE(m.email, u.email, ''), '@', 1)
         ) AS name
  FROM public.account_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.account_id = _account_id
    AND public.is_account_member(_account_id)
  ORDER BY 3
$$;

-- Inicia o cronômetro encerrando qualquer contagem ativa do mesmo usuário.
CREATE OR REPLACE FUNCTION public.start_task_timer(_task_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  IF NOT public.can_view_task(_task_id) THEN RAISE EXCEPTION 'Sem acesso a esta tarefa'; END IF;

  UPDATE public.time_entries SET stopped_at = now()
  WHERE user_id = auth.uid() AND stopped_at IS NULL;

  INSERT INTO public.time_entries (task_id, user_id, started_at)
  VALUES (_task_id, auth.uid(), now())
  RETURNING id INTO _id;

  RETURN _id;
END; $$;

-- Encerra o cronômetro ativo do usuário (opcionalmente um registro específico).
CREATE OR REPLACE FUNCTION public.stop_task_timer(_entry_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  UPDATE public.time_entries SET stopped_at = now()
  WHERE user_id = auth.uid() AND stopped_at IS NULL
    AND (_entry_id IS NULL OR id = _entry_id)
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

-- Cria um quadro já com o conjunto de status escolhido, em uma única transação.
CREATE OR REPLACE FUNCTION public.create_board_with_statuses(
  _space_id uuid,
  _name text,
  _statuses jsonb,
  _description text DEFAULT NULL,
  _owner_id uuid DEFAULT NULL,
  _start_date date DEFAULT NULL,
  _due_date date DEFAULT NULL,
  _default_view text DEFAULT 'kanban',
  _color text DEFAULT '#3B82F6'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _board_id uuid; _item jsonb; _i int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  IF NOT public.can_edit_space(_space_id) THEN RAISE EXCEPTION 'Sem permissão neste espaço'; END IF;

  INSERT INTO public.boards (space_id, name, description, owner_id, start_date, due_date,
                             default_view, color, created_by)
  VALUES (_space_id, _name, _description, COALESCE(_owner_id, auth.uid()), _start_date, _due_date,
          COALESCE(_default_view, 'kanban'), COALESCE(_color, '#3B82F6'), auth.uid())
  RETURNING id INTO _board_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(COALESCE(_statuses, '[]'::jsonb)) LOOP
    INSERT INTO public.board_statuses (board_id, name, sort_order, color, polarity, is_default)
    VALUES (
      _board_id,
      _item ->> 'name',
      _i,
      COALESCE(_item ->> 'color', '#64748B'),
      COALESCE(_item ->> 'polarity', 'IN_PROGRESS'),
      COALESCE((_item ->> 'is_default')::boolean, _i = 0)
    );
    _i := _i + 1;
  END LOOP;

  RETURN _board_id;
END; $$;

-- ---------------------------------------------------------------------
-- 7) PERMISSÕES DE EXECUÇÃO
-- ---------------------------------------------------------------------

-- O PostgreSQL avalia as expressões das policies com os privilégios de quem
-- executa a consulta: toda função usada dentro de uma policy precisa de EXECUTE
-- para `authenticated`, caso contrário a leitura/escrita falha com
-- "permission denied for function". Por isso as funções-predicado ficam
-- liberadas para `authenticated` e bloqueadas para PUBLIC/anon — cada uma
-- responde apenas sobre o acesso do próprio usuário autenticado.
REVOKE EXECUTE ON FUNCTION public.space_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_space(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_space(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.board_space(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_board(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_board(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.task_board(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_task(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_task(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.status_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.space_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_space(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_space(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.board_space(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.task_board(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_task(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.status_board(uuid) TO authenticated;

-- As policies deste módulo também dependem das funções de conta já existentes.
-- A migração 20260821104439 revogou o EXECUTE delas de `authenticated`, o que
-- impede a avaliação das policies (inclusive as das tabelas financeiras).
-- Restauramos o acesso mantendo PUBLIC e anon bloqueados.
REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_account_owner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.account_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profile_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_account(uuid) TO authenticated;

-- Funções de gatilho e de auditoria não são chamadas diretamente pelo cliente.
REVOKE EXECUTE ON FUNCTION public.log_task_activity(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_task_completion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_subtask_completion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_time_entry_duration() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_task_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_participant_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_subtask_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_time_entry_changes() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.account_users(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_task_timer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stop_task_timer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_board_with_statuses(uuid, text, jsonb, text, uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_users(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_task_timer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_task_timer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_board_with_statuses(uuid, text, jsonb, text, uuid, date, date, text, text) TO authenticated;
