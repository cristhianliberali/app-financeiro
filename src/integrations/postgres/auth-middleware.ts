import { createMiddleware } from "@tanstack/react-start";

/** Mensagem usada quando não há sessão válida — o front trata redirecionando. */
export const UNAUTHENTICATED = "Sessão expirada";

export type AuthedUser = {
  id: string;
  email: string;
  name: string | null;
  /** Tela em que o app abre para esta pessoa; nulo = o padrão do app. */
  startRoute: string | null;
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

  // O app não tem processo de fundo próprio: quem levanta o agendador da agenda
  // é o primeiro acesso autenticado depois de o servidor subir. A chamada é
  // idempotente e não custa nada nas seguintes.
  const { ensureCalendarScheduler } = await import("./calendar-scheduler.server");
  ensureCalendarScheduler();

  return next({ context: { user } });
});

/** Igual ao `requireAuth`, mas devolve `user: null` em vez de falhar. */
export const optionalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { readSession } = await import("./session.server");
  return next({ context: { user: await readSession() } });
});

/**
 * Mensagem usada quando há sessão válida mas o plano não libera o app. É
 * distinta de `UNAUTHENTICATED` porque o desfecho na tela é outro: ali a pessoa
 * precisa entrar de novo, aqui ela já está logada e precisa resolver a
 * assinatura — mandá-la para o login seria esconder o problema real.
 */
export const PLANO_INATIVO = "Assinatura inativa";

/**
 * Exige sessão válida **e** plano que libere o app.
 *
 * É esta a trava de verdade. Esconder botões na interface não protege nada: as
 * server functions são endpoints HTTP, e quem já esteve logado sabe o caminho
 * delas. Toda função que lê ou escreve dado financeiro ou de tarefa passa por
 * aqui.
 *
 * O que **não** passa, de propósito: entrar, sair, ver e editar o próprio
 * cadastro, e consultar o estado da assinatura. Trancar essas seria trancar a
 * pessoa fora da tela que existe para ela voltar a pagar.
 */
export const requirePlano = createMiddleware({ type: "function" })
  .middleware([requireAuth])
  .server(async ({ next, context }) => {
    const { lerAcesso } = await import("./plano.server");
    const acesso = await lerAcesso(context.user.id);
    if (!acesso.liberado) throw new Error(PLANO_INATIVO);
    return next({ context: { acesso } });
  });
