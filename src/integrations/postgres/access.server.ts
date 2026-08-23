/**
 * Autorização das contas compartilhadas.
 *
 * Antes isso vivia em policies de RLS no Supabase. Com a conexão direta ao
 * Postgres o app fala com o banco como um único usuário, então a checagem
 * passou para cá — e toda server function que toca dados de conta precisa
 * chamar uma destas funções antes de ler ou escrever.
 */
import { queryOne } from "./client.server";

export type AccountRole = "owner" | "editor" | "viewer";

/** Tabelas de dados que pertencem a um perfil (`profile_id`). */
export const PROFILE_TABLES = [
  "categories",
  "transactions",
  "recurring_rules",
  "investments",
  "goals",
] as const;

export type ProfileTable = (typeof PROFILE_TABLES)[number];
export type DataTable = ProfileTable | "budget_profiles";

export class ForbiddenError extends Error {
  constructor(message = "Você não tem acesso a esta conta") {
    super(message);
    this.name = "ForbiddenError";
  }
}

const RANK: Record<AccountRole, number> = { viewer: 0, editor: 1, owner: 2 };

export async function getAccountRole(
  userId: string,
  accountId: string,
): Promise<AccountRole | null> {
  const row = await queryOne<{ role: AccountRole }>(
    `SELECT role FROM account_members WHERE account_id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  return row?.role ?? null;
}

/** Garante que o usuário tem pelo menos o papel pedido na conta. */
export async function requireAccountRole(
  userId: string,
  accountId: string,
  minimum: AccountRole,
): Promise<AccountRole> {
  const role = await getAccountRole(userId, accountId);
  if (!role || RANK[role] < RANK[minimum]) throw new ForbiddenError();
  return role;
}

/** Conta dona de um perfil, ou `null` se o perfil não existe. */
export async function accountOfProfile(profileId: string): Promise<string | null> {
  const row = await queryOne<{ account_id: string }>(
    `SELECT account_id FROM budget_profiles WHERE id = $1`,
    [profileId],
  );
  return row?.account_id ?? null;
}

export async function requireProfileAccess(
  userId: string,
  profileId: string,
  minimum: AccountRole,
): Promise<{ accountId: string; role: AccountRole }> {
  const accountId = await accountOfProfile(profileId);
  if (!accountId) throw new ForbiddenError("Perfil não encontrado");
  const role = await requireAccountRole(userId, accountId, minimum);
  return { accountId, role };
}

/** Conta dona de uma linha qualquer das tabelas de dados. */
export async function accountOfRow(table: DataTable, rowId: string): Promise<string | null> {
  if (table === "budget_profiles") {
    const row = await queryOne<{ account_id: string }>(
      `SELECT account_id FROM budget_profiles WHERE id = $1`,
      [rowId],
    );
    return row?.account_id ?? null;
  }

  // O nome da tabela vem de uma lista fechada (`PROFILE_TABLES`), nunca do
  // corpo da requisição — daí ser seguro interpolar aqui.
  const row = await queryOne<{ account_id: string }>(
    `SELECT p.account_id
       FROM ${table} t
       JOIN budget_profiles p ON p.id = t.profile_id
      WHERE t.id = $1`,
    [rowId],
  );
  return row?.account_id ?? null;
}

export async function requireRowAccess(
  userId: string,
  table: DataTable,
  rowId: string,
  minimum: AccountRole,
): Promise<string> {
  const accountId = await accountOfRow(table, rowId);
  if (!accountId) throw new ForbiddenError("Registro não encontrado");
  await requireAccountRole(userId, accountId, minimum);
  return accountId;
}
