import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateBasis } from "./app-state";

export type BudgetProfile = {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
};

export type Category = {
  id: string;
  profile_id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  emoji: string;
  monthly_cap: number | null;
};

export type Transaction = {
  id: string;
  profile_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  kind: "income" | "expense";
  transaction_date: string;
  due_date: string;
  status: "paid" | "pending";
  installment_no: number | null;
  installment_total: number | null;
  installment_group: string | null;
  notes: string | null;
};

export type RecurringRule = {
  id: string;
  profile_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  kind: "income" | "expense";
  frequency: "monthly" | "weekly" | "yearly";
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  active: boolean;
};

export type Investment = {
  id: string;
  profile_id: string;
  name: string;
  type: string;
  invested_amount: number;
  current_amount: number;
  expected_rate: number;
  started_at: string;
};

export type Goal = {
  id: string;
  profile_id: string;
  title: string;
  kind: "personal" | "financial" | "saving" | "investment";
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  done: boolean;
};

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sessão expirada");
  return data.user.id;
}

const DEFAULT_CATEGORIES: Array<Omit<Category, "id" | "profile_id">> = [
  { name: "Moradia", kind: "expense", color: "#3B82F6", emoji: "🏠", monthly_cap: 3000 },
  { name: "Alimentação", kind: "expense", color: "#F97316", emoji: "🍕", monthly_cap: 1500 },
  { name: "Transporte", kind: "expense", color: "#8B5CF6", emoji: "🚗", monthly_cap: 800 },
  { name: "Lazer", kind: "expense", color: "#EC4899", emoji: "🎬", monthly_cap: 600 },
  { name: "Saúde", kind: "expense", color: "#14B8A6", emoji: "💊", monthly_cap: 500 },
  { name: "Salário", kind: "income", color: "#10B981", emoji: "💼", monthly_cap: null },
  { name: "Freelance", kind: "income", color: "#22C55E", emoji: "🧾", monthly_cap: null },
];

export function useProfiles() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async (): Promise<BudgetProfile[]> => {
      const uid = await userId();
      const { data, error } = await supabase
        .from("budget_profiles")
        .select("id,name,color,is_default")
        .order("created_at");
      if (error) throw error;
      if (data && data.length > 0) return data as BudgetProfile[];

      // Bootstrap: primeiro acesso cria os perfis e categorias padrão
      const { data: created, error: e2 } = await supabase
        .from("budget_profiles")
        .insert([
          { user_id: uid, name: "Pessoal", color: "#3B82F6", is_default: true },
          { user_id: uid, name: "Empresa", color: "#10B981", is_default: false },
        ])
        .select("id,name,color,is_default");
      if (e2) throw e2;
      const profiles = (created ?? []) as BudgetProfile[];
      const rows = profiles.flatMap((p) =>
        DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: uid, profile_id: p.id })),
      );
      if (rows.length) await supabase.from("categories").insert(rows);
      qc.invalidateQueries({ queryKey: ["categories"] });
      return profiles;
    },
  });
}

export function useCategories(profileId: string | null) {
  return useQuery({
    queryKey: ["categories", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,profile_id,name,kind,color,emoji,monthly_cap")
        .eq("profile_id", profileId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

export function useTransactions(opts: {
  profileId: string | null;
  from?: string;
  to?: string;
  basis?: DateBasis;
}) {
  const { profileId, from, to, basis = "transaction_date" } = opts;
  return useQuery({
    queryKey: ["transactions", profileId, from, to, basis],
    enabled: !!profileId,
    queryFn: async (): Promise<Transaction[]> => {
      let q = supabase
        .from("transactions")
        .select(
          "id,profile_id,category_id,description,amount,kind,transaction_date,due_date,status,installment_no,installment_total,installment_group,notes",
        )
        .eq("profile_id", profileId!);
      if (from) q = q.gte(basis, from);
      if (to) q = q.lte(basis, to);
      const { data, error } = await q.order(basis, { ascending: false }).limit(2000);
      if (error) throw error;
      return (data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as Transaction[];
    },
  });
}

export function useRecurring(profileId: string | null) {
  return useQuery({
    queryKey: ["recurring", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<RecurringRule[]> => {
      const { data, error } = await supabase
        .from("recurring_rules")
        .select("*")
        .eq("profile_id", profileId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as RecurringRule[];
    },
  });
}

export function useInvestments(profileId: string | null) {
  return useQuery({
    queryKey: ["investments", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Investment[]> => {
      const { data, error } = await supabase
        .from("investments")
        .select("*")
        .eq("profile_id", profileId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((i) => ({
        ...i,
        invested_amount: Number(i.invested_amount),
        current_amount: Number(i.current_amount),
        expected_rate: Number(i.expected_rate),
      })) as Investment[];
    },
  });
}

export function useGoals(profileId: string | null) {
  return useQuery({
    queryKey: ["goals", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("profile_id", profileId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((g) => ({
        ...g,
        target_amount: Number(g.target_amount),
        current_amount: Number(g.current_amount),
      })) as Goal[];
    },
  });
}

type TableName =
  | "transactions"
  | "categories"
  | "budget_profiles"
  | "recurring_rules"
  | "investments"
  | "goals";

const invalidationKey: Record<TableName, string> = {
  transactions: "transactions",
  categories: "categories",
  budget_profiles: "profiles",
  recurring_rules: "recurring",
  investments: "investments",
  goals: "goals",
};

export function useUpsert(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const uid = await userId();
      const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, user_id: uid }));
      const { error } = await supabase
        .from(table)
        .upsert(list as never, { onConflict: "id", defaultToNull: false });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [invalidationKey[table]] });
      if (table === "categories") qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useRemove(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [invalidationKey[table]] }),
  });
}
