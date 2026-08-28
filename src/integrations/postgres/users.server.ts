/**
 * Cadastro e autenticação de usuários no Postgres da própria aplicação.
 */
import { query, queryOne } from "./client.server";
import { hashPassword, verifyPassword } from "./password.server";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
};

type UserWithSecret = UserRow & { password_hash: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserWithSecret | null> {
  return queryOne<UserWithSecret>(
    `SELECT id, email, full_name, password_hash FROM app_users WHERE email = $1`,
    [normalizeEmail(email)],
  );
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT id, email, full_name FROM app_users WHERE id = $1`, [id]);
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string | null;
}): Promise<UserRow> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const row = await queryOne<UserRow>(
    `INSERT INTO app_users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, full_name`,
    [email, passwordHash, input.name?.trim() || null],
  );
  if (!row) throw new Error("Já existe uma conta com este e-mail");
  return row;
}

/** Devolve o usuário quando e-mail e senha conferem, senão `null`. */
export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Gasta o mesmo tempo do caminho feliz para não vazar, pela latência da
    // resposta, quais e-mails existem no banco.
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, email: user.email, full_name: user.full_name };
}

export async function updatePassword(userId: string, password: string): Promise<void> {
  await query(`UPDATE app_users SET password_hash = $2 WHERE id = $1`, [
    userId,
    await hashPassword(password),
  ]);
}

/** Quantidade de contas já cadastradas — usada para liberar o primeiro acesso. */
export async function countUsers(): Promise<number> {
  const row = await queryOne<{ total: number }>(`SELECT count(*)::bigint AS total FROM app_users`);
  return row?.total ?? 0;
}
