/**
 * Sessões de login persistidas no Postgres.
 *
 * O token vive num cookie httpOnly (o navegador nunca o lê por JS) e no banco
 * guardamos apenas o SHA-256 dele: um dump da tabela `user_sessions` não
 * permite se passar por ninguém. Sessão no banco também dá logout de verdade —
 * revogar é apagar a linha, sem esperar um JWT expirar.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { getSessionCookieName, getSessionTtlDays } from "./config.server";
import { query, queryOne } from "./client.server";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  /** Tela em que o app abre para esta pessoa; nulo = o padrão do app. */
  startRoute: string | null;
};

type SessionRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  start_route: string | null;
  expires_at: Date;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isSecureRequest(): boolean {
  // Atrás do proxy do EasyPanel o Node só enxerga http://localhost, então o
  // domínio público configurado é quem decide se o cookie pode ser `Secure`.
  const appUrl = process.env["APP_URL"] ?? process.env["VITE_APP_URL"] ?? "";
  if (appUrl.startsWith("https://")) return true;
  if (appUrl.startsWith("http://")) return false;
  return process.env["NODE_ENV"] === "production";
}

/** Cria a sessão no banco e grava o cookie na resposta. Devolve o token. */
export async function startSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const ttlDays = getSessionTtlDays();

  await query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, hashToken(token), String(ttlDays)],
  );

  setCookie(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(),
    path: "/",
    maxAge: ttlDays * 24 * 60 * 60,
  });

  return token;
}

/** Usuário da requisição atual, ou `null` quando não há sessão válida. */
export async function readSession(): Promise<SessionUser | null> {
  const token = getCookie(getSessionCookieName());
  if (!token) return null;

  const row = await queryOne<SessionRow>(
    `SELECT s.user_id, s.expires_at, u.email, u.full_name, u.start_route
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) return null;

  // `last_seen_at` é só telemetria de sessão; falhar aqui não pode derrubar o
  // login de quem já está autenticado.
  void query(`UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1`, [
    hashToken(token),
  ]).catch(() => {});

  return {
    id: row.user_id,
    email: row.email,
    name: row.full_name,
    startRoute: row.start_route,
  };
}

/** Revoga a sessão da requisição atual e limpa o cookie. */
export async function endSession(): Promise<void> {
  const cookieName = getSessionCookieName();
  const token = getCookie(cookieName);
  if (token) {
    await query(`DELETE FROM user_sessions WHERE token_hash = $1`, [hashToken(token)]).catch(
      (error) => console.error("[postgres] não foi possível revogar a sessão:", error),
    );
  }
  deleteCookie(cookieName, { path: "/", sameSite: "lax", secure: isSecureRequest() });
}

/** Revoga todas as sessões de um usuário (troca de senha, "sair de tudo"). */
export async function endAllSessions(userId: string): Promise<void> {
  await query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
}

/** Comparação em tempo constante para tokens vindos de link (convites). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
