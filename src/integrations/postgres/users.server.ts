/**
 * Cadastro e autenticação de usuários no Postgres da própria aplicação.
 */
import { query, queryOne } from "./client.server";
import { hashPassword, verifyPassword } from "./password.server";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  /** Tela em que o app abre para esta pessoa; nulo = o padrão do app. */
  start_route: string | null;
};

type UserWithSecret = UserRow & { password_hash: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserWithSecret | null> {
  return queryOne<UserWithSecret>(
    `SELECT id, email, full_name, start_route, password_hash FROM app_users WHERE email = $1`,
    [normalizeEmail(email)],
  );
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT id, email, full_name, start_route FROM app_users WHERE id = $1`,
    [id],
  );
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
     RETURNING id, email, full_name, start_route`,
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
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    start_route: user.start_route,
  };
}

export async function updatePassword(userId: string, password: string): Promise<void> {
  // `senha_provisoria = false` no mesmo UPDATE, e não numa chamada separada:
  // escolher a própria senha é exatamente o que encerra a provisória, e separar
  // as duas coisas abriria a chance de a marca sobreviver à troca.
  await query(`UPDATE app_users SET password_hash = $2, senha_provisoria = false WHERE id = $1`, [
    userId,
    await hashPassword(password),
  ]);
}

/** Quantidade de contas já cadastradas — usada para liberar o primeiro acesso. */
export async function countUsers(): Promise<number> {
  const row = await queryOne<{ total: number }>(`SELECT count(*)::bigint AS total FROM app_users`);
  return row?.total ?? 0;
}

/**
 * Cria a conta de quem comprou antes de se cadastrar.
 *
 * Diferente de `createUser`, não é um cadastro: ninguém escolheu esta senha, e
 * é por isso que `senha_provisoria` nasce `true` — o app e o painel precisam
 * saber que existe uma credencial em trânsito num e-mail.
 *
 * Devolve `null` quando a conta já existia. Corrida entre dois webhooks do
 * mesmo comprador é rara, mas é exatamente o tipo de coisa que só aparece em
 * produção: o `ON CONFLICT` resolve no banco, e não numa checagem antes do
 * insert que a outra requisição poderia atravessar.
 */
export async function criarUsuarioProvisionado(input: {
  email: string;
  senha: string;
  nome?: string | null;
}): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `INSERT INTO app_users (email, password_hash, full_name, senha_provisoria, acesso_provisionado_em)
     VALUES ($1, $2, $3, true, now())
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, full_name, start_route`,
    [normalizeEmail(input.email), await hashPassword(input.senha), input.nome?.trim() || null],
  );
}

/**
 * Troca a senha de uma conta que já existe por uma provisória, e marca o
 * provisionamento como feito.
 *
 * As sessões abertas **não** são derrubadas aqui. Quem chama é o webhook, não a
 * pessoa: expulsar do app alguém que está no meio de um lançamento porque uma
 * cobrança foi processada seria o app agindo pelas costas dela. A senha antiga
 * deixa de valer, o que basta para o e-mail fazer sentido.
 */
export async function aplicarSenhaProvisoria(userId: string, senha: string): Promise<void> {
  await query(
    `UPDATE app_users
        SET password_hash = $2, senha_provisoria = true,
            acesso_provisionado_em = now(), updated_at = now()
      WHERE id = $1`,
    [userId, await hashPassword(senha)],
  );
}

/**
 * Some com a marca de senha provisória. Chamado quando a pessoa escolhe a
 * própria senha — é o que fecha o ciclo aberto pelo e-mail.
 */
export async function limparSenhaProvisoria(userId: string): Promise<void> {
  await query(
    `UPDATE app_users SET senha_provisoria = false, updated_at = now()
      WHERE id = $1 AND senha_provisoria = true`,
    [userId],
  );
}
