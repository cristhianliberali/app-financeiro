CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.budget_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_profiles TO authenticated;
GRANT ALL ON public.budget_profiles TO service_role;
ALTER TABLE public.budget_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own budget_profiles" ON public.budget_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_budget_profiles_updated BEFORE UPDATE ON public.budget_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.budget_profiles ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense',
  color TEXT NOT NULL DEFAULT '#3B82F6',
  emoji TEXT NOT NULL DEFAULT '💸',
  monthly_cap NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own categories" ON public.categories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_categories_updated BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.budget_profiles ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense',
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  installment_no INT,
  installment_total INT,
  installment_group UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_profile_dates ON public.transactions (profile_id, transaction_date, due_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transactions" ON public.transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_transactions_updated BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.budget_profiles ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense',
  frequency TEXT NOT NULL DEFAULT 'monthly',
  day_of_month INT NOT NULL DEFAULT 1,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rules TO authenticated;
GRANT ALL ON public.recurring_rules TO service_role;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recurring_rules" ON public.recurring_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_recurring_updated BEFORE UPDATE ON public.recurring_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.budget_profiles ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Renda Fixa',
  invested_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  started_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO authenticated;
GRANT ALL ON public.investments TO service_role;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own investments" ON public.investments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_investments_updated BEFORE UPDATE ON public.investments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.budget_profiles ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'financial',
  target_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  target_date DATE,
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own goals" ON public.goals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER t_goals_updated BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();