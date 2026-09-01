import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

/** Espelha `DATA_TABLES` do servidor para validar a entrada já no cliente. */
export const DATA_TABLES = [
  "budget_profiles",
  "categories",
  "transactions",
  "recurring_rules",
  "investments",
  "goals",
] as const;

export type DataTableName = (typeof DATA_TABLES)[number];

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

function requireTable(value: unknown): DataTableName {
  if (typeof value !== "string" || !(DATA_TABLES as readonly string[]).includes(value)) {
    throw new Error(`Tabela não suportada: ${String(value)}`);
  }
  return value as DataTableName;
}

export const fetchProfiles = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) => {
    const { listProfiles } = await import("@/integrations/postgres/repository.server");
    return listProfiles(context.user.id, data.accountId);
  });

export const fetchCategories = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string }) => ({ profileId: requireId(input?.profileId) }))
  .handler(async ({ data, context }) => {
    const { listCategories } = await import("@/integrations/postgres/repository.server");
    return listCategories(context.user.id, data.profileId);
  });

export const fetchTransactions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string; from?: string; to?: string; basis?: string }) => ({
    profileId: requireId(input?.profileId),
    ...(input?.from ? { from: input.from } : {}),
    ...(input?.to ? { to: input.to } : {}),
    // Vira nome de coluna no ORDER BY/WHERE do servidor: só estes dois valores.
    basis: input?.basis === "due_date" ? ("due_date" as const) : ("transaction_date" as const),
  }))
  .handler(async ({ data, context }) => {
    const { listTransactions } = await import("@/integrations/postgres/repository.server");
    return listTransactions(context.user.id, data);
  });

export const fetchRecurring = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string }) => ({ profileId: requireId(input?.profileId) }))
  .handler(async ({ data, context }) => {
    const { listRecurring } = await import("@/integrations/postgres/repository.server");
    return listRecurring(context.user.id, data.profileId);
  });

export const fetchInvestments = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string }) => ({ profileId: requireId(input?.profileId) }))
  .handler(async ({ data, context }) => {
    const { listInvestments } = await import("@/integrations/postgres/repository.server");
    return listInvestments(context.user.id, data.profileId);
  });

export const fetchGoals = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string }) => ({ profileId: requireId(input?.profileId) }))
  .handler(async ({ data, context }) => {
    const { listGoals } = await import("@/integrations/postgres/repository.server");
    return listGoals(context.user.id, data.profileId);
  });

/**
 * Grava a recorrência e já cria a série de lançamentos dela.
 *
 * Não passa pelo `upsertRows` genérico de propósito: gravar a regra e
 * materializar a série são uma coisa só, e precisam cair na mesma transação.
 */
export const saveRecurring = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      profileId: string;
      categoryId: string;
      description: string;
      amount: number;
      kind: "income" | "expense";
      frequency: "monthly" | "weekly" | "yearly";
      dayOfMonth: number;
      startDate: string;
      endDate?: string | null;
    }) => {
      const amount = Number(input?.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor válido");
      if (!input?.description?.trim()) throw new Error("Informe a descrição");
      // A série vira lançamento, e lançamento sem categoria é recusado.
      const categoryId = requireId(input?.categoryId, "categoryId");
      if (!["monthly", "weekly", "yearly"].includes(input?.frequency)) {
        throw new Error("Frequência inválida");
      }
      if (input?.kind !== "income" && input?.kind !== "expense") throw new Error("Tipo inválido");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.startDate ?? "")) {
        throw new Error("Informe a data de início");
      }
      return {
        ...(input.id ? { id: requireId(input.id) } : {}),
        profileId: requireId(input?.profileId, "profileId"),
        categoryId,
        description: input.description.trim(),
        amount,
        kind: input.kind,
        frequency: input.frequency,
        dayOfMonth: Math.min(31, Math.max(1, Math.trunc(Number(input?.dayOfMonth) || 1))),
        startDate: input.startDate,
        endDate: input?.endDate ?? null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ id: string; created: number }> => {
    const { saveRecurringRule } = await import("@/integrations/postgres/recurring.server");
    return saveRecurringRule(context.user.id, data);
  });

/** Quantos lançamentos a regra tem hoje — o que a confirmação de exclusão mostra. */
export const fetchRecurringImpact = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }) => {
    const { recurringImpact } = await import("@/integrations/postgres/recurring.server");
    return recurringImpact(context.user.id, data.id);
  });

/** Exclui a regra, com o destino dos lançamentos escolhido por quem exclui. */
export const removeRecurring = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string; scope: "all" | "future" | "keep" }) => {
    if (!["all", "future", "keep"].includes(input?.scope)) {
      throw new Error("Escolha o que fazer com os lançamentos já criados");
    }
    return { id: requireId(input?.id), scope: input.scope };
  })
  .handler(async ({ data, context }): Promise<{ removed: number }> => {
    const { deleteRecurringRule } = await import("@/integrations/postgres/recurring.server");
    return deleteRecurringRule(context.user.id, data.id, data.scope);
  });

export const upsertRows = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      table: DataTableName;
      rows: Record<string, unknown> | Record<string, unknown>[];
    }) => {
      const rows = Array.isArray(input?.rows) ? input.rows : [input?.rows];
      if (rows.some((row) => row === null || typeof row !== "object")) {
        throw new Error("Payload inválido");
      }
      return { table: requireTable(input?.table), rows: rows as Record<string, unknown>[] };
    },
  )
  .handler(async ({ data, context }): Promise<null> => {
    const { upsertRows: run } = await import("@/integrations/postgres/repository.server");
    await run(context.user.id, data.table, data.rows);
    return null;
  });

/** Exclusão em massa: uma transação no banco, uma requisição só. */
export const removeManyRows = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { table: DataTableName; ids: string[] }) => {
    const ids = Array.isArray(input?.ids) ? input.ids : [];
    if (ids.length === 0) throw new Error("Nenhum registro selecionado");
    // Teto de sanidade: nenhuma tela seleciona mais que isso de uma vez.
    if (ids.length > 500) throw new Error("Selecione no máximo 500 registros por vez");
    return { table: requireTable(input?.table), ids: ids.map((id) => requireId(id)) };
  })
  .handler(async ({ data, context }): Promise<{ removed: number }> => {
    const { removeRows } = await import("@/integrations/postgres/repository.server");
    return removeRows(context.user.id, data.table, data.ids);
  });

export const removeRow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { table: DataTableName; id: string }) => ({
    table: requireTable(input?.table),
    id: requireId(input?.id),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    const { removeRow: run } = await import("@/integrations/postgres/repository.server");
    await run(context.user.id, data.table, data.id);
    return null;
  });
