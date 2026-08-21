-- 1) TABELAS
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_members TO authenticated;
GRANT ALL ON public.account_members TO service_role;
ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.account_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor','viewer')),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_invites_token_key ON public.account_invites(token);
CREATE UNIQUE INDEX account_invites_pending_key ON public.account_invites(account_id, lower(email)) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_invites TO authenticated;
GRANT ALL ON public.account_invites TO service_role;
ALTER TABLE public.account_invites ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER t_accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_account_members_updated BEFORE UPDATE ON public.account_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_account_invites_updated BEFORE UPDATE ON public.account_invites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) FUNÇÕES DE ACESSO
CREATE OR REPLACE FUNCTION public.account_role(_account_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.account_members WHERE account_id = _account_id AND user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_account_member(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_members WHERE account_id = _account_id AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_edit_account(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_members WHERE account_id = _account_id AND user_id = auth.uid() AND role IN ('owner','editor'))
$$;

CREATE OR REPLACE FUNCTION public.is_account_owner(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.account_members WHERE account_id = _account_id AND user_id = auth.uid() AND role = 'owner')
$$;

-- 3) POLICIES DE CONTAS
CREATE POLICY "members read accounts" ON public.accounts FOR SELECT TO authenticated USING (public.is_account_member(id));
CREATE POLICY "create own account" ON public.accounts FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner updates account" ON public.accounts FOR UPDATE TO authenticated USING (public.is_account_owner(id)) WITH CHECK (public.is_account_owner(id));
CREATE POLICY "owner deletes account" ON public.accounts FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "members read members" ON public.account_members FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY "owner manages members" ON public.account_members FOR ALL TO authenticated
  USING (public.is_account_owner(account_id)) WITH CHECK (public.is_account_owner(account_id));
CREATE POLICY "leave account" ON public.account_members FOR DELETE TO authenticated USING (user_id = auth.uid() AND role <> 'owner');

CREATE POLICY "owner manages invites" ON public.account_invites FOR ALL TO authenticated
  USING (public.is_account_owner(account_id)) WITH CHECK (public.is_account_owner(account_id) AND invited_by = auth.uid());

-- 4) BOOTSTRAP DE MEMBRO DONO AO CRIAR CONTA
CREATE OR REPLACE FUNCTION public.add_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.account_members (account_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER t_accounts_owner_member AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.add_owner_member();

-- 5) ACEITAR CONVITE
CREATE OR REPLACE FUNCTION public.accept_account_invite(_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.account_invites%ROWTYPE; my_email text;
BEGIN
  SELECT lower(coalesce(auth.jwt() ->> 'email','')) INTO my_email;
  SELECT * INTO inv FROM public.account_invites WHERE token = _token AND status = 'pending';
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Convite inválido ou já utilizado'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Convite expirado'; END IF;
  IF lower(inv.email) <> my_email THEN RAISE EXCEPTION 'Este convite é para outro e-mail'; END IF;
  INSERT INTO public.account_members (account_id, user_id, role, email)
  VALUES (inv.account_id, auth.uid(), inv.role, my_email)
  ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  UPDATE public.account_invites SET status = 'accepted' WHERE id = inv.id;
  RETURN inv.account_id;
END; $$;

CREATE OR REPLACE FUNCTION public.invite_preview(_token uuid)
RETURNS TABLE(account_name text, role text, email text, expires_at timestamptz, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.name, i.role, i.email, i.expires_at, i.status
  FROM public.account_invites i JOIN public.accounts a ON a.id = i.account_id
  WHERE i.token = _token
$$;

-- 6) PERFIS PERTENCEM A UMA CONTA (migração dos dados existentes)
ALTER TABLE public.budget_profiles ADD COLUMN account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

INSERT INTO public.accounts (owner_id, name)
SELECT DISTINCT user_id, 'Minha conta' FROM public.budget_profiles;

UPDATE public.budget_profiles p
SET account_id = a.id
FROM public.accounts a
WHERE a.owner_id = p.user_id AND p.account_id IS NULL;

DELETE FROM public.budget_profiles WHERE account_id IS NULL;
ALTER TABLE public.budget_profiles ALTER COLUMN account_id SET NOT NULL;
CREATE INDEX budget_profiles_account_idx ON public.budget_profiles(account_id);

CREATE OR REPLACE FUNCTION public.profile_account(_profile_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM public.budget_profiles WHERE id = _profile_id
$$;

-- 7) NOVAS POLICIES BASEADAS EM MEMBRO
DROP POLICY IF EXISTS "own budget_profiles" ON public.budget_profiles;
CREATE POLICY "members read profiles" ON public.budget_profiles FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY "editors write profiles" ON public.budget_profiles FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(account_id) AND user_id = auth.uid());
CREATE POLICY "editors update profiles" ON public.budget_profiles FOR UPDATE TO authenticated USING (public.can_edit_account(account_id)) WITH CHECK (public.can_edit_account(account_id));
CREATE POLICY "editors delete profiles" ON public.budget_profiles FOR DELETE TO authenticated USING (public.can_edit_account(account_id));

DROP POLICY IF EXISTS "own categories" ON public.categories;
CREATE POLICY "members read categories" ON public.categories FOR SELECT TO authenticated USING (public.is_account_member(public.profile_account(profile_id)));
CREATE POLICY "editors write categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(public.profile_account(profile_id)) AND user_id = auth.uid());
CREATE POLICY "editors update categories" ON public.categories FOR UPDATE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id))) WITH CHECK (public.can_edit_account(public.profile_account(profile_id)));
CREATE POLICY "editors delete categories" ON public.categories FOR DELETE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id)));

DROP POLICY IF EXISTS "own transactions" ON public.transactions;
CREATE POLICY "members read transactions" ON public.transactions FOR SELECT TO authenticated USING (public.is_account_member(public.profile_account(profile_id)));
CREATE POLICY "editors write transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(public.profile_account(profile_id)) AND user_id = auth.uid());
CREATE POLICY "editors update transactions" ON public.transactions FOR UPDATE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id))) WITH CHECK (public.can_edit_account(public.profile_account(profile_id)));
CREATE POLICY "editors delete transactions" ON public.transactions FOR DELETE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id)));

DROP POLICY IF EXISTS "own recurring_rules" ON public.recurring_rules;
CREATE POLICY "members read recurring" ON public.recurring_rules FOR SELECT TO authenticated USING (public.is_account_member(public.profile_account(profile_id)));
CREATE POLICY "editors write recurring" ON public.recurring_rules FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(public.profile_account(profile_id)) AND user_id = auth.uid());
CREATE POLICY "editors update recurring" ON public.recurring_rules FOR UPDATE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id))) WITH CHECK (public.can_edit_account(public.profile_account(profile_id)));
CREATE POLICY "editors delete recurring" ON public.recurring_rules FOR DELETE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id)));

DROP POLICY IF EXISTS "own investments" ON public.investments;
CREATE POLICY "members read investments" ON public.investments FOR SELECT TO authenticated USING (public.is_account_member(public.profile_account(profile_id)));
CREATE POLICY "editors write investments" ON public.investments FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(public.profile_account(profile_id)) AND user_id = auth.uid());
CREATE POLICY "editors update investments" ON public.investments FOR UPDATE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id))) WITH CHECK (public.can_edit_account(public.profile_account(profile_id)));
CREATE POLICY "editors delete investments" ON public.investments FOR DELETE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id)));

DROP POLICY IF EXISTS "own goals" ON public.goals;
CREATE POLICY "members read goals" ON public.goals FOR SELECT TO authenticated USING (public.is_account_member(public.profile_account(profile_id)));
CREATE POLICY "editors write goals" ON public.goals FOR INSERT TO authenticated WITH CHECK (public.can_edit_account(public.profile_account(profile_id)) AND user_id = auth.uid());
CREATE POLICY "editors update goals" ON public.goals FOR UPDATE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id))) WITH CHECK (public.can_edit_account(public.profile_account(profile_id)));
CREATE POLICY "editors delete goals" ON public.goals FOR DELETE TO authenticated USING (public.can_edit_account(public.profile_account(profile_id)));