/**
 * Leitura e escrita das tabelas de dados (perfis, categorias, lançamentos,
 * recorrências, investimentos e metas).
 *
 * Os nomes de tabela e de coluna que chegam do cliente nunca são interpolados
 * direto no SQL: passam pelas listas fechadas abaixo. Valores sempre vão como
 * parâmetro (`$1`, `$2`, …).
 */
import type { PoolClient } from "pg";

import { query, withTransaction } from "./client.server";
import {
  PROFILE_TABLES,
  requireAccountRole,
  requireProfileAccess,
  requireRowAccess,
  type DataTable,
} from "./access.server";

export const DATA_TABLES: DataTable[] = ["budget_profiles", ...PROFILE_TABLES];

/** Colunas que o cliente pode gravar, por tabela. */
const WRITABLE_COLUMNS: Record<DataTable, readonly string[]> = {
  budget_profiles: ["account_id", "name", "color", "is_default"],
  categories: [
    "profile_id",
    "name",
    "kind",
    "color",
    "emoji",
    "monthly_cap",
    "description",
    // Arquivar/reativar é um UPDATE desta coluna: a categoria some das listas
    // de lançamento novo, mas continua nos relatórios do que já foi lançado.
    "archived_at",
  ],
  transactions: [
    "profile_id",
    "category_id",
    "description",
    "amount",
    "kind",
    "transaction_date",
    "due_date",
    "status",
    "installment_no",
    "installment_total",
    "installment_group",
    "notes",
  ],
  recurring_rules: [
    "profile_id",
    "category_id",
    "description",
    "amount",
    "kind",
    "frequency",
    "day_of_month",
    "start_date",
    "end_date",
    "active",
  ],
  investments: [
    "profile_id",
    "name",
    "type",
    "invested_amount",
    "current_amount",
    "expected_rate",
    "started_at",
  ],
  goals: ["profile_id", "title", "kind", "target_amount", "current_amount", "target_date", "done"],
};

const PROFILE_COLUMNS = "id, name, color, is_default";
// `archived_at` sai como texto ISO em UTC, e não como o `Date` que o driver
// devolveria: é a mesma convenção do módulo de tarefas, e o front só trabalha
// com ISO (que o Safari aceita em `new Date(...)`).
const CATEGORY_COLUMNS =
  "id, profile_id, name, kind, color, emoji, monthly_cap, description, " +
  `to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS archived_at`;
const TRANSACTION_COLUMNS =
  "id, profile_id, category_id, description, amount, kind, transaction_date, due_date, status, " +
  "installment_no, installment_total, installment_group, notes, recurring_rule_id";
const RECURRING_COLUMNS =
  "id, profile_id, category_id, description, amount, kind, frequency, day_of_month, start_date, " +
  "end_date, active";
const INVESTMENT_COLUMNS =
  "id, profile_id, name, type, invested_amount, current_amount, expected_rate, started_at";
const GOAL_COLUMNS =
  "id, profile_id, title, kind, target_amount, current_amount, target_date, done";

export function assertDataTable(table: string): asserts table is DataTable {
  if (!(DATA_TABLES as string[]).includes(table)) {
    throw new Error(`Tabela não suportada: ${table}`);
  }
}

/*
 * Categorias que toda conta nova recebe. `emoji` guarda o nome do ícone do
 * banco de ícones (src/lib/icons.tsx) — a coluna manteve o nome antigo para
 * não quebrar o histórico de quem já tinha categorias com emoji gravado.
 */
const DEFAULT_CATEGORIES = [
  { name: "Moradia", kind: "expense", color: "#6366F1", emoji: "home", monthly_cap: 3000 },
  { name: "Alimentação", kind: "expense", color: "#F97316", emoji: "utensils", monthly_cap: 1500 },
  { name: "Transporte", kind: "expense", color: "#8B5CF6", emoji: "car", monthly_cap: 800 },
  { name: "Lazer", kind: "expense", color: "#EC4899", emoji: "clapperboard", monthly_cap: 600 },
  { name: "Saúde", kind: "expense", color: "#06B6D4", emoji: "pill", monthly_cap: 500 },
  { name: "Salário", kind: "income", color: "#10B981", emoji: "briefcase", monthly_cap: null },
  { name: "Freelance", kind: "income", color: "#84CC16", emoji: "hand-coins", monthly_cap: null },
] as const;

// ─────────────────────────────── leitura ────────────────────────────────

export async function listProfiles(userId: string, accountId: string) {
  const role = await requireAccountRole(userId, accountId, "viewer");

  const rows = await query(
    `SELECT ${PROFILE_COLUMNS} FROM budget_profiles WHERE account_id = $1 ORDER BY created_at`,
    [accountId],
  );
  if (rows.length > 0 || role === "viewer") return rows;

  // Primeiro acesso da conta: cria os perfis e as categorias padrão.
  return withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO budget_profiles (user_id, account_id, name, color, is_default)
       VALUES ($1, $2, 'Pessoal', '#3B82F6', true), ($1, $2, 'Empresa', '#10B981', false)
       RETURNING ${PROFILE_COLUMNS}`,
      [userId, accountId],
    );

    for (const profile of created.rows) {
      for (const category of DEFAULT_CATEGORIES) {
        await client.query(
          `INSERT INTO categories (user_id, profile_id, name, kind, color, emoji, monthly_cap)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            profile["id"],
            category.name,
            category.kind,
            category.color,
            category.emoji,
            category.monthly_cap,
          ],
        );
      }
    }
    return created.rows;
  });
}

/**
 * Todas as categorias do perfil, arquivadas inclusive: os relatórios precisam
 * do nome e da cor das arquivadas para exibir os lançamentos antigos. Quem
 * oferece categoria para lançamento novo é que filtra por `archived_at`.
 */
export async function listCategories(userId: string, profileId: string) {
  await requireProfileAccess(userId, profileId, "viewer");
  return query(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE profile_id = $1
      ORDER BY archived_at NULLS FIRST, name`,
    [profileId],
  );
}

export async function listTransactions(
  userId: string,
  opts: { profileId: string; from?: string; to?: string; basis: "transaction_date" | "due_date" },
) {
  await requireProfileAccess(userId, opts.profileId, "viewer");

  /*
   * O horizonte das recorrências é conferido aqui, na leitura, e não por uma
   * rotina de fundo: é o que faz a série seguir para a frente sozinha sem o app
   * precisar de um processo próprio. Quase sempre não há nada a criar, e a
   * função sai no primeiro SELECT.
   */
  const { ensureRecurringMaterialized } = await import("./recurring.server");
  await ensureRecurringMaterialized(userId, opts.profileId).catch((error) =>
    // Falhar em completar a série não pode impedir a tela de mostrar o que já
    // existe — o extrato é mais importante que a projeção.
    console.error("[recorrência] não foi possível completar a série:", error),
  );

  // `basis` só pode ser uma das duas colunas de data — validado no
  // inputValidator da server function antes de chegar aqui.
  const basis = opts.basis === "due_date" ? "due_date" : "transaction_date";
  const params: unknown[] = [opts.profileId];
  let sql = `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE profile_id = $1`;
  if (opts.from) sql += ` AND ${basis} >= $${params.push(opts.from)}`;
  if (opts.to) sql += ` AND ${basis} <= $${params.push(opts.to)}`;
  sql += ` ORDER BY ${basis} DESC LIMIT 2000`;

  return query(sql, params);
}

export async function listRecurring(userId: string, profileId: string) {
  await requireProfileAccess(userId, profileId, "viewer");
  return query(
    `SELECT ${RECURRING_COLUMNS} FROM recurring_rules WHERE profile_id = $1 ORDER BY created_at DESC`,
    [profileId],
  );
}

export async function listInvestments(userId: string, profileId: string) {
  await requireProfileAccess(userId, profileId, "viewer");
  return query(
    `SELECT ${INVESTMENT_COLUMNS} FROM investments WHERE profile_id = $1 ORDER BY created_at DESC`,
    [profileId],
  );
}

export async function listGoals(userId: string, profileId: string) {
  await requireProfileAccess(userId, profileId, "viewer");
  return query(`SELECT ${GOAL_COLUMNS} FROM goals WHERE profile_id = $1 ORDER BY created_at DESC`, [
    profileId,
  ]);
}

// ─────────────────────────────── escrita ────────────────────────────────

type Row = Record<string, unknown>;

/**
 * Insere ou atualiza linhas. Uma linha com `id` de registro existente vira
 * UPDATE apenas das colunas enviadas (o front manda payloads parciais, como
 * `{ id, done }`); qualquer outra vira INSERT.
 */
export async function upsertRows(userId: string, table: DataTable, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  await withTransaction(async (client) => {
    for (const row of rows) await upsertRow(client, userId, table, row);
  });
}

/**
 * Lançamento sem categoria não entra.
 *
 * A categoria é o que faz o lançamento existir nos relatórios: sem ela o valor
 * some do teto de orçamento, do gráfico por categoria e de qualquer leitura que
 * não seja o extrato cru. A regra vale no servidor, e não só no formulário,
 * porque são vários os caminhos que gravam lançamento — o diálogo, a
 * importação, o parcelamento — e todos passam por aqui.
 *
 * No UPDATE a exigência só vale se a coluna vier na atualização: dar baixa numa
 * pendência manda `status` e mais nada, e não é hora de cobrar o resto.
 */
function requireCategory(row: Row, isInsert: boolean): void {
  const hasKey = row["category_id"] !== undefined;
  if (!isInsert && !hasKey) return;
  const categoryId = row["category_id"];
  if (typeof categoryId !== "string" || !categoryId.trim()) {
    throw new Error("Escolha uma categoria para o lançamento");
  }
}

async function upsertRow(
  client: PoolClient,
  userId: string,
  table: DataTable,
  row: Row,
): Promise<void> {
  const allowed = WRITABLE_COLUMNS[table];
  const columns = allowed.filter((column) => row[column] !== undefined);
  const id = typeof row["id"] === "string" && row["id"] ? row["id"] : null;

  const existing = id
    ? await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])
    : { rowCount: 0 };

  if (id && existing.rowCount) {
    await requireRowAccess(userId, table, id, "editor");
    if (table === "transactions") requireCategory(row, false);
    if (columns.length === 0) return;
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
    await client.query(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id = $1`, [
      id,
      ...columns.map((column) => row[column]),
    ]);
    return;
  }

  await authorizeInsert(userId, table, row);
  if (table === "transactions") requireCategory(row, true);

  const insertColumns = ["user_id", ...columns, ...(id ? ["id"] : [])];
  const values = [userId, ...columns.map((column) => row[column]), ...(id ? [id] : [])];
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);

  await client.query(
    `INSERT INTO ${table} (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values,
  );
}

async function authorizeInsert(userId: string, table: DataTable, row: Row): Promise<void> {
  if (table === "budget_profiles") {
    const accountId = row["account_id"];
    if (typeof accountId !== "string" || !accountId) {
      throw new Error("account_id é obrigatório para criar um perfil");
    }
    await requireAccountRole(userId, accountId, "editor");
    return;
  }

  const profileId = row["profile_id"];
  if (typeof profileId !== "string" || !profileId) {
    throw new Error("profile_id é obrigatório");
  }
  await requireProfileAccess(userId, profileId, "editor");
}

export async function removeRow(userId: string, table: DataTable, id: string): Promise<void> {
  await requireRowAccess(userId, table, id, "editor");
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}
