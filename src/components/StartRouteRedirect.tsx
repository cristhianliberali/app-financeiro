import { useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import { markStartRouteApplied, normalizeStartRoute, startRouteApplied } from "@/lib/start-route";

/**
 * Leva quem entra para a tela que a pessoa escolheu abrir.
 *
 * Só age na raiz (`/`), que é onde o app deposita quem acabou de entrar, e só
 * uma vez por aba: navegar de volta ao dashboard depois disso é uma escolha
 * deliberada, e um redirecionamento teimoso tornaria o dashboard inalcançável.
 *
 * O desvio acontece no cliente, depois da primeira pintura — a sessão vive num
 * cookie httpOnly, então quem sabe a preferência é o servidor, e ela só chega
 * junto com a resposta de quem está logado. Na prática é um piscar do dashboard
 * antes da tela escolhida.
 */
export function StartRouteRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading || !user || pathname !== "/") return;
    if (startRouteApplied(user.id)) return;
    markStartRouteApplied(user.id);

    const target = normalizeStartRoute(user.startRoute);
    if (target !== "/") void navigate({ to: target, replace: true });
  }, [loading, user, pathname, navigate]);

  return null;
}
