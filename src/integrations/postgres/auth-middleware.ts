import { createMiddleware } from "@tanstack/react-start";

/** Mensagem usada quando não há sessão válida — o front trata redirecionando. */
export const UNAUTHENTICATED = "Sessão expirada";

export type AuthedUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Exige sessão válida e injeta o usuário no contexto da server function.
 *
 * Os módulos do Postgres entram por `await import()` dentro do handler: este
 * arquivo é importado por `*.functions.ts`, que vai para o bundle do
 * navegador, e `pg` só existe no Node.
 */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { readSession } = await import("./session.server");
  const user = await readSession();
  if (!user) throw new Error(UNAUTHENTICATED);
  return next({ context: { user } });
});

/** Igual ao `requireAuth`, mas devolve `user: null` em vez de falhar. */
export const optionalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { readSession } = await import("./session.server");
  return next({ context: { user: await readSession() } });
});
