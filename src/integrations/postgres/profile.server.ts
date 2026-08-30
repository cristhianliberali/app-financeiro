/**
 * Perfil da pessoa logada: nome, troca de e-mail e redefinição de senha.
 *
 * Os dois fluxos que passam por e-mail seguem o mesmo princípio das sessões: o
 * banco guarda só o SHA-256 do código/token, nunca o valor em claro. Quem lê a
 * tabela não consegue nem trocar o e-mail de alguém nem redefinir uma senha.
 *
 * A troca de e-mail confirma no endereço NOVO — é o único jeito de provar que a
 * pessoa realmente recebe lá antes de mover o acesso da conta para ele.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

import { query, queryOne, withTransaction } from "./client.server";
import { hashPassword } from "./password.server";
import { endAllSessions } from "./session.server";
import { findUserById, normalizeEmail, type UserRow } from "./users.server";

/** Validade do código de confirmação de e-mail. */
const EMAIL_CODE_TTL_MINUTES = 15;
/** Validade do link de redefinição de senha. */
const PASSWORD_RESET_TTL_MINUTES = 60;
/** Tentativas de código antes de a solicitação ser queimada. */
const MAX_CODE_ATTEMPTS = 5;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Código de 6 dígitos, sorteado com o gerador criptográfico do Node. */
function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized)) throw new Error("Informe um e-mail válido");
  return normalized;
}

// ───────────────────────────────── nome ─────────────────────────────────

export async function updateUserName(userId: string, name: string | null): Promise<UserRow> {
  const clean = name?.trim() ? name.trim().slice(0, 120) : null;
  const row = await queryOne<UserRow>(
    `UPDATE app_users SET full_name = $2 WHERE id = $1 RETURNING id, email, full_name`,
    [userId, clean],
  );
  if (!row) throw new Error("Usuário não encontrado");
  return row;
}

// ──────────────────────────── troca de e-mail ───────────────────────────

export type EmailChangeRequest = {
  newEmail: string;
  expiresInMinutes: number;
};

/**
 * Gera o código e o envia para o endereço novo. Solicitações anteriores da
 * mesma pessoa são queimadas: vale sempre o último código pedido.
 */
export async function requestEmailChange(
  userId: string,
  rawEmail: string,
): Promise<EmailChangeRequest> {
  const newEmail = assertEmail(rawEmail);

  const user = await findUserById(userId);
  if (!user) throw new Error("Usuário não encontrado");
  if (user.email === newEmail) throw new Error("Este já é o e-mail da sua conta");

  const taken = await queryOne<{ id: string }>(`SELECT id FROM app_users WHERE email = $1`, [
    newEmail,
  ]);
  if (taken) throw new Error("Já existe uma conta com este e-mail");

  const code = newCode();

  await query(
    `UPDATE email_change_requests SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
  await query(
    `INSERT INTO email_change_requests (user_id, new_email, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [userId, newEmail, sha256(code), String(EMAIL_CODE_TTL_MINUTES)],
  );

  const { sendEmailChangeCodeEmail } = await import("../mail/templates.server");
  await sendEmailChangeCodeEmail({
    to: newEmail,
    name: user.full_name,
    code,
    expiresInMinutes: EMAIL_CODE_TTL_MINUTES,
  });

  return { newEmail, expiresInMinutes: EMAIL_CODE_TTL_MINUTES };
}

type PendingChange = { id: string; new_email: string; code_hash: string; attempts: number };

/** Confere o código e move o e-mail da conta. Devolve o usuário atualizado. */
export async function confirmEmailChange(userId: string, rawCode: string): Promise<UserRow> {
  const code = rawCode.replace(/\D/g, "");
  if (code.length !== 6) throw new Error("O código tem 6 dígitos");

  const pending = await queryOne<PendingChange>(
    `SELECT id, new_email, code_hash, attempts
       FROM email_change_requests
      WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
  if (!pending) {
    throw new Error("Nenhuma troca de e-mail pendente. Peça um novo código.");
  }

  if (pending.code_hash !== sha256(code)) {
    const attempts = pending.attempts + 1;
    // Esgotadas as tentativas, a solicitação morre: adivinhar 6 dígitos exige
    // recomeçar o fluxo (e receber outro e-mail no endereço novo).
    await query(
      `UPDATE email_change_requests
          SET attempts = $2, consumed_at = CASE WHEN $2 >= $3 THEN now() ELSE NULL END
        WHERE id = $1`,
      [pending.id, attempts, MAX_CODE_ATTEMPTS],
    );
    throw new Error(
      attempts >= MAX_CODE_ATTEMPTS
        ? "Código incorreto. Tentativas esgotadas — peça um novo código."
        : `Código incorreto. Restam ${MAX_CODE_ATTEMPTS - attempts} tentativa(s).`,
    );
  }

  const previous = await findUserById(userId);

  const updated = await withTransaction(async (client) => {
    const result = await client.query<UserRow>(
      `UPDATE app_users SET email = $2 WHERE id = $1 RETURNING id, email, full_name`,
      [userId, pending.new_email],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Usuário não encontrado");

    // `account_members.email` é o rótulo que a tela de equipe mostra; sem isto
    // os outros membros continuariam vendo o endereço antigo.
    await client.query(`UPDATE account_members SET email = $2 WHERE user_id = $1`, [
      userId,
      pending.new_email,
    ]);
    await client.query(`UPDATE email_change_requests SET consumed_at = now() WHERE id = $1`, [
      pending.id,
    ]);
    return row;
  });

  // O aviso ao endereço antigo é cortesia: falhar aqui não desfaz a troca.
  if (previous) {
    const { sendEmailChangedNoticeEmail } = await import("../mail/templates.server");
    await sendEmailChangedNoticeEmail({
      to: previous.email,
      name: previous.full_name,
      newEmail: updated.email,
    }).catch((error) => console.error("[smtp] aviso de troca de e-mail falhou:", error));
  }

  return updated;
}

/** Cancela a troca pendente (o botão "cancelar" da tela de perfil). */
export async function cancelEmailChange(userId: string): Promise<void> {
  await query(
    `UPDATE email_change_requests SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
}

/** Troca pendente, para a tela reabrir no passo do código depois de um F5. */
export async function pendingEmailChange(userId: string): Promise<EmailChangeRequest | null> {
  const row = await queryOne<{ new_email: string; minutes: number }>(
    `SELECT new_email, CEIL(EXTRACT(EPOCH FROM (expires_at - now())) / 60)::int AS minutes
       FROM email_change_requests
      WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
  return row ? { newEmail: row.new_email, expiresInMinutes: Math.max(1, row.minutes) } : null;
}

// ────────────────────────── redefinição de senha ────────────────────────

/**
 * Cria o token e manda o link. Não diz se o e-mail existe: quem chama sempre
 * recebe a mesma resposta, senão a tela vira um verificador de cadastros.
 */
export async function requestPasswordReset(
  rawEmail: string,
  linkFor: (token: string) => string,
): Promise<void> {
  const email = assertEmail(rawEmail);

  const user = await queryOne<UserRow>(
    `SELECT id, email, full_name FROM app_users WHERE email = $1`,
    [email],
  );
  if (!user) {
    console.info(`[senha] pedido de redefinição para e-mail sem cadastro: ${email}`);
    return;
  }

  // Um pedido por minuto por conta: como a tela é aberta (não exige login), sem
  // isto ela viraria um jeito fácil de encher a caixa de entrada de alguém.
  const recent = await queryOne<{ id: string }>(
    `SELECT id FROM password_resets
      WHERE user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '1 minute'`,
    [user.id],
  );
  if (recent) {
    console.info(`[senha] pedido de redefinição repetido em menos de 1 minuto: ${email}`);
    return;
  }

  const token = randomBytes(32).toString("base64url");

  await query(
    `UPDATE password_resets SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [user.id],
  );
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [user.id, sha256(token), String(PASSWORD_RESET_TTL_MINUTES)],
  );

  const { sendPasswordResetEmail } = await import("../mail/templates.server");
  await sendPasswordResetEmail({
    to: user.email,
    name: user.full_name,
    link: linkFor(token),
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });
}

/** O link ainda vale? A tela usa isto antes de mostrar o formulário. */
export async function isPasswordResetTokenValid(token: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM password_resets
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  return !!row;
}

/**
 * Aplica a nova senha e derruba todas as sessões: se a conta foi perdida para
 * alguém, redefinir a senha tem que expulsar quem estava dentro.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_resets
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  if (!row) throw new Error("Link inválido ou expirado. Peça uma nova redefinição.");

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await client.query(`UPDATE app_users SET password_hash = $2 WHERE id = $1`, [
      row.user_id,
      passwordHash,
    ]);
    await client.query(`UPDATE password_resets SET consumed_at = now() WHERE id = $1`, [row.id]);
  });

  await endAllSessions(row.user_id);
}
