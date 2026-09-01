/**
 * Tela em que o app abre.
 *
 * Quem vive nas tarefas não quer ver o dashboard financeiro toda manhã, e quem
 * vive nas contas não quer o painel de projetos. A preferência é da pessoa, não
 * do navegador — ela viaja com o login, e por isso mora no banco, não no
 * `localStorage`.
 *
 * A lista é fechada de propósito: o valor vira destino de navegação, e aceitar
 * um caminho qualquer vindo do cliente transformaria a preferência num vetor de
 * redirecionamento. As duas pontas (formulário e servidor) validam contra ela.
 */
export const START_ROUTES = [
  { value: "/", label: "Dashboard financeiro", group: "Finanças" },
  { value: "/transacoes", label: "Centro de transações", group: "Finanças" },
  { value: "/pendentes", label: "Transações pendentes", group: "Finanças" },
  { value: "/categorias", label: "Categorias", group: "Finanças" },
  { value: "/investimentos", label: "Investimentos", group: "Finanças" },
  { value: "/metas", label: "Metas", group: "Finanças" },
  { value: "/tarefas", label: "Visão geral", group: "Projetos e Tarefas" },
  { value: "/tarefas/meu-dia", label: "Meu dia", group: "Projetos e Tarefas" },
  { value: "/tarefas/agenda", label: "Minha Agenda", group: "Projetos e Tarefas" },
  { value: "/tarefas/espacos", label: "Espaços", group: "Projetos e Tarefas" },
] as const;

export type StartRoute = (typeof START_ROUTES)[number]["value"];

/** Sem escolha, o app abre onde sempre abriu. */
export const DEFAULT_START_ROUTE: StartRoute = "/";

export function isStartRoute(value: unknown): value is StartRoute {
  return (
    typeof value === "string" && START_ROUTES.some((route) => route.value === (value as StartRoute))
  );
}

/** O caminho salvo, ou o padrão quando ele é desconhecido (ou de uma versão antiga). */
export function normalizeStartRoute(value: unknown): StartRoute {
  return isStartRoute(value) ? value : DEFAULT_START_ROUTE;
}

/** Os grupos na ordem em que aparecem, para montar o seletor sem repetir a lista. */
export const START_ROUTE_GROUPS = [...new Set(START_ROUTES.map((route) => route.group))];

/** Guarda, por aba, em qual usuário a preferência de abertura já foi aplicada. */
const APPLIED_KEY = "aura.startRoute.aplicada";

/** A preferência já foi aplicada nesta aba para este usuário? */
export function startRouteApplied(userId: string): boolean {
  try {
    return sessionStorage.getItem(APPLIED_KEY) === userId;
  } catch {
    // Sem sessionStorage a preferência apenas reaplica com mais frequência.
    return false;
  }
}

export function markStartRouteApplied(userId: string): void {
  try {
    sessionStorage.setItem(APPLIED_KEY, userId);
  } catch {
    // Idem.
  }
}

/** Esquece a aplicação — chamado ao sair, para o próximo login voltar a valer. */
export function forgetStartRoute(): void {
  try {
    sessionStorage.removeItem(APPLIED_KEY);
  } catch {
    // Idem.
  }
}
