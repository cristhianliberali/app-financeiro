/**
 * Contas compartilhadas: membros, papéis e convites.
 *
 * Substitui as funções `SECURITY DEFINER` que rodavam no Supabase
 * (`accept_account_invite`, `invite_preview`, …). Como o app agora fala com o
 * banco com um único usuário, quem decide o que cada pessoa pode fazer é o
 * `requireAccountRole` chamado no começo de cada operação.
 */
import { query, queryOne, withTransaction } from "./client.server";
import { ForbiddenError, requireAccountRole, type AccountRole } from "./access.server";

export type AccountRow = {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  role: AccountRole;
};

const ACCOUNT_COLUMNS = "a.id, a.name, a.color, a.owner_id";

export async function listAccounts(userId: string, email: string): Promise<AccountRow[]> {
  const rows = await query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS}, m.role
       FROM account_members m
       JOIN accounts a ON a.id = m.account_id
      WHERE m.user_id = $1
      ORDER BY m.created_at`,
    [userId],
  );
  if (rows.length > 0) return rows;

  // Primeiro login: cada usuário ganha uma conta própria para começar.
  const created = await createAccount(userId, email, { name: "Minha conta", color: "#3B82F6" });
  return [created];
}

export async function createAccount(
  userId: string,
  email: string,
  input: { name: string; color: string },
): Promise<AccountRow> {
  return withTransaction(async (client) => {
    const account = await client.query<Omit<AccountRow, "role">>(
      `INSERT INTO accounts (owner_id, name, color) VALUES ($1, $2, $3)
       RETURNING id, name, color, owner_id`,
      [userId, input.name.trim() || "Minha conta", input.color],
    );
    const row = account.rows[0]!;
    // O trigger `t_accounts_owner_member` já cria o vínculo de dono; aqui só
    // completamos o e-mail, que a tabela `accounts` não conhece.
    await client.query(
      `UPDATE account_members SET email = $2 WHERE account_id = $1 AND user_id = $3`,
      [row.id, email, userId],
    );
    return { ...row, role: "owner" as const };
  });
}

export async function updateAccount(
  userId: string,
  input: { id: string; name?: string; color?: string },
): Promise<void> {
  await requireAccountRole(userId, input.id, "owner");
  const columns: string[] = [];
  const values: unknown[] = [input.id];
  if (input.name !== undefined) columns.push(`name = $${values.push(input.name)}`);
  if (input.color !== undefined) columns.push(`color = $${values.push(input.color)}`);
  if (columns.length === 0) return;
  await query(`UPDATE accounts SET ${columns.join(", ")} WHERE id = $1`, values);
}

export async function deleteAccount(userId: string, accountId: string): Promise<void> {
  await requireAccountRole(userId, accountId, "owner");
  // Apagar a conta leva junto perfis, lançamentos, membros e convites (ON
  // DELETE CASCADE), então só o dono de fato pode fazê-lo.
  const deleted = await query(`DELETE FROM accounts WHERE id = $1 AND owner_id = $2 RETURNING id`, [
    accountId,
    userId,
  ]);
  if (deleted.length === 0) throw new ForbiddenError("Só o dono pode excluir a conta");
}

export async function listMembers(userId: string, accountId: string) {
  await requireAccountRole(userId, accountId, "viewer");
  return query(
    `SELECT id, user_id, role, email, created_at::text
       FROM account_members WHERE account_id = $1 ORDER BY created_at`,
    [accountId],
  );
}

export async function updateMember(
  userId: string,
  input: { id: string; role: AccountRole },
): Promise<void> {
  const member = await requireMemberOwnership(userId, input.id);
  if (member.role === "owner") throw new ForbiddenError("O papel do dono não pode ser alterado");
  if (input.role === "owner") throw new ForbiddenError("Transfira a conta em vez de criar um dono");
  await query(`UPDATE account_members SET role = $2 WHERE id = $1`, [input.id, input.role]);
}

export async function removeMember(userId: string, memberId: string): Promise<void> {
  const member = await queryOne<{ account_id: string; user_id: string; role: AccountRole }>(
    `SELECT account_id, user_id, role FROM account_members WHERE id = $1`,
    [memberId],
  );
  if (!member) throw new ForbiddenError("Membro não encontrado");
  if (member.role === "owner") throw new ForbiddenError("O dono não pode ser removido da conta");

  // Sair da conta por conta própria é permitido a qualquer membro; remover
  // outra pessoa é privilégio do dono.
  if (member.user_id !== userId) await requireAccountRole(userId, member.account_id, "owner");

  await query(`DELETE FROM account_members WHERE id = $1`, [memberId]);
}

async function requireMemberOwnership(userId: string, memberId: string) {
  const member = await queryOne<{ account_id: string; user_id: string; role: AccountRole }>(
    `SELECT account_id, user_id, role FROM account_members WHERE id = $1`,
    [memberId],
  );
  if (!member) throw new ForbiddenError("Membro não encontrado");
  await requireAccountRole(userId, member.account_id, "owner");
  return member;
}

// ─────────────────────────────── convites ───────────────────────────────

export async function listInvites(userId: string, accountId: string) {
  await requireAccountRole(userId, accountId, "owner");
  return query(
    `SELECT id, email, role, token, status, expires_at::text, created_at::text
       FROM account_invites WHERE account_id = $1 ORDER BY created_at DESC`,
    [accountId],
  );
}

export async function inviteMember(
  userId: string,
  accountId: string,
  input: { email: string; role: "editor" | "viewer" },
): Promise<string> {
  await requireAccountRole(userId, accountId, "owner");
  const email = input.email.trim().toLowerCase();

  const row = await queryOne<{ token: string }>(
    `INSERT INTO account_invites (account_id, email, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, lower(email)) WHERE status = 'pending'
     DO UPDATE SET role = EXCLUDED.role,
                   invited_by = EXCLUDED.invited_by,
                   expires_at = now() + interval '14 days'
     RETURNING token`,
    [accountId, email, input.role, userId],
  );
  if (!row) throw new Error("Não foi possível criar o convite");
  return row.token;
}

export async function revokeInvite(userId: string, inviteId: string): Promise<void> {
  const invite = await queryOne<{ account_id: string }>(
    `SELECT account_id FROM account_invites WHERE id = $1`,
    [inviteId],
  );
  if (!invite) return;
  await requireAccountRole(userId, invite.account_id, "owner");
  await query(`DELETE FROM account_invites WHERE id = $1`, [inviteId]);
}

export type InvitePreview = {
  account_name: string;
  role: AccountRole;
  email: string;
  expires_at: string;
  status: string;
};

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  return queryOne<InvitePreview>(
    `SELECT a.name AS account_name, i.role, i.email, i.expires_at::text, i.status
       FROM account_invites i
       JOIN accounts a ON a.id = i.account_id
      WHERE i.token = $1`,
    [token],
  );
}

/** Aceita o convite para o e-mail do usuário logado e devolve a conta. */
export async function acceptInvite(userId: string, email: string, token: string): Promise<string> {
  return withTransaction(async (client) => {
    const found = await client.query<{
      id: string;
      account_id: string;
      email: string;
      role: Exclude<AccountRole, "owner">;
      expired: boolean;
    }>(
      `SELECT id, account_id, email, role, expires_at < now() AS expired
         FROM account_invites
        WHERE token = $1 AND status = 'pending'
        FOR UPDATE`,
      [token],
    );

    const invite = found.rows[0];
    if (!invite) throw new Error("Convite inválido ou já utilizado");
    if (invite.expired) throw new Error("Convite expirado");
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Este convite é para outro e-mail");
    }

    await client.query(
      `INSERT INTO account_members (account_id, user_id, role, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invite.account_id, userId, invite.role, email],
    );
    await client.query(`UPDATE account_invites SET status = 'accepted' WHERE id = $1`, [invite.id]);

    return invite.account_id;
  });
}
