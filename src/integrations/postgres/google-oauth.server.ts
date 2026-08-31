/**
 * Início e fim do consentimento do Google, do lado do servidor.
 *
 * O `state` viaja num cookie httpOnly de vida curta: é ele que amarra o retorno
 * do Google à sessão que começou a conexão. Sem essa amarração, bastaria
 * alguém abrir um link de callback forjado para pendurar a própria agenda na
 * conta de outra pessoa.
 */
import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { getSiteUrl } from "@/lib/site-url";
import { authorizationUrl, exchangeCode } from "../google/oauth.server";
import { readSession } from "./session.server";
import { saveConnection, syncUser } from "./google.server";

const STATE_COOKIE = "aura_google_state";
const STATE_TTL_SECONDS = 10 * 60;

/** URL de consentimento + cookie de `state`, para o front redirecionar. */
export async function startGoogleConnection(): Promise<string> {
  const state = randomBytes(24).toString("base64url");

  setCookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: getSiteUrl().startsWith("https://"),
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  return authorizationUrl({ siteUrl: getSiteUrl(), state });
}

/** Conclui a conexão e devolve para onde o navegador deve ir. */
export async function finishGoogleConnection(input: {
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<{ redirectTo: string }> {
  const destino = (status: string) => ({ redirectTo: `/tarefas?agenda=${status}` });

  const expected = getCookie(STATE_COOKIE);
  deleteCookie(STATE_COOKIE, { path: "/" });

  if (input.error) {
    console.info(`[agenda] consentimento recusado: ${input.error}`);
    return destino("recusado");
  }
  if (!input.code || !input.state || !expected || input.state !== expected) {
    console.error("[agenda] retorno do Google sem código ou com state que não confere");
    return destino("invalido");
  }

  const user = await readSession();
  if (!user) return destino("sessao");

  try {
    const tokens = await exchangeCode({ code: input.code, siteUrl: getSiteUrl() });
    await saveConnection(user.id, tokens);
    // A agenda de quem acabou de conectar não pode nascer vazia: as tarefas com
    // prazo que já existiam sobem agora. Se o Google falhar aqui, a conexão
    // continua feita e a próxima rodada tenta de novo.
    const pushed = await syncUser(user.id).catch((error) => {
      console.error("[agenda] primeira sincronização falhou:", error);
      return { pushed: 0 };
    });
    if (pushed.pushed > 0) {
      console.info(`[agenda] ${pushed.pushed} tarefa(s) existentes foram para a agenda`);
    }
    console.info(
      `[agenda] ${user.email} conectou a agenda ${tokens.email ?? "(e-mail não informado)"}`,
    );
    return destino("conectado");
  } catch (error) {
    console.error("[agenda] falha ao concluir a conexão:", error);
    // 42P01 = tabela inexistente: o deploy subiu com o código novo, mas o
    // `db:migrate` ainda não rodou. Vale distinguir, porque a saída é outra.
    if (isMissingTable(error)) return destino("banco");
    return destino("falhou");
  }
}

/** Erro do Postgres de tabela que não existe. */
function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01"
  );
}
