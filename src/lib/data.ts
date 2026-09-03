import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchCategories,
  fetchGoals,
  fetchInvestments,
  fetchProfiles,
  fetchRecurring,
  fetchRecurringImpact,
  fetchTransactions,
  removeManyRows,
  removeRecurring,
  removeRow,
  saveRecurring,
  upsertRows,
  type DataTableName,
} from "./data.functions";
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
  /** Palavras-chave da fatura; vão junto na importação por IA. */
  description: string | null;
  /**
   * Categoria arquivada: continua aparecendo nos relatórios do que já foi
   * lançado, mas não é oferecida para lançamento novo. Substitui a exclusão,
   * que deixaria os lançamentos antigos sem categoria.
   */
  archived_at: string | null;
};

/** As que ainda recebem lançamento — o filtro de todo seletor de categoria. */
export function activeCategories(categories: Category[]): Category[] {
  return categories.filter((category) => !category.archived_at);
}

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
  /** Preenchido quando o lançamento nasceu de uma recorrência. */
  recurring_rule_id: string | null;
  /** A regra que gerou este lançamento é de valor variável. */
  recurring_variable?: boolean;
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
  /** O valor da regra é estimativa; cada ocorrência confirma o seu ao ser paga. */
  variable_amount: boolean;
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

export function useProfiles(accountId: string | null) {
  return useQuery({
    queryKey: ["profiles", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<BudgetProfile[]> =>
      (await fetchProfiles({ data: { accountId: accountId! } })) as BudgetProfile[],
  });
}

export function useCategories(profileId: string | null) {
  return useQuery({
    queryKey: ["categories", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Category[]> =>
      (await fetchCategories({ data: { profileId: profileId! } })) as Category[],
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
    queryFn: async (): Promise<Transaction[]> =>
      (await fetchTransactions({
        data: { profileId: profileId!, ...(from ? { from } : {}), ...(to ? { to } : {}), basis },
      })) as Transaction[],
  });
}

export function useRecurring(profileId: string | null) {
  return useQuery({
    queryKey: ["recurring", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<RecurringRule[]> =>
      (await fetchRecurring({ data: { profileId: profileId! } })) as RecurringRule[],
  });
}

/**
 * Salva a recorrência e cria a série dela.
 *
 * Invalida também as transações: a gravação acabou de criar dezenas delas, e a
 * lista atrás do diálogo estaria mentindo sem isso.
 */
export function useSaveRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof saveRecurring>[0]["data"]) =>
      saveRecurring({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Quantos lançamentos a regra tem — lido ao abrir a confirmação de exclusão. */
export function useRecurringImpact() {
  return useMutation({ mutationFn: (id: string) => fetchRecurringImpact({ data: { id } }) });
}

export function useRemoveRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; scope: "all" | "future" | "keep" }) =>
      removeRecurring({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useInvestments(profileId: string | null) {
  return useQuery({
    queryKey: ["investments", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Investment[]> =>
      (await fetchInvestments({ data: { profileId: profileId! } })) as Investment[],
  });
}

export function useGoals(profileId: string | null) {
  return useQuery({
    queryKey: ["goals", profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Goal[]> =>
      (await fetchGoals({ data: { profileId: profileId! } })) as Goal[],
  });
}

type TableName = DataTableName;

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
      await upsertRows({ data: { table, rows } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [invalidationKey[table]] });
      if (table === "categories") qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Exclusão em massa da tabela, numa requisição só. */
export function useRemoveMany(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => removeManyRows({ data: { table, ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [invalidationKey[table]] }),
  });
}

export function useRemove(table: TableName) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await removeRow({ data: { table, id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [invalidationKey[table]] }),
  });
}
