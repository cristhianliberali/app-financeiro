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
