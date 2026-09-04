import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";
import type { Acesso } from "@/integrations/postgres/plano.server";

export type { Acesso };

/**
 * Estado da assinatura de quem está logado.
 *
 * Fica em `requireAuth` e não em `requirePlano` de propósito: é justamente a
 * função que quem está bloqueado precisa conseguir chamar. Colocá-la atrás da
 * trava faria a tela de bloqueio não conseguir dizer por que bloqueou.
 */
export const getAcesso = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(
    async ({
      context,
    }): Promise<Acesso & { checkoutUrl: string | null; caktoConfigurada: boolean }> => {
      const { lerAcesso } = await import("@/integrations/postgres/plano.server");
      const { getCaktoCheckoutUrl, isCaktoConfigured } =
        await import("@/integrations/postgres/config.server");

      return {
        ...(await lerAcesso(context.user.id)),
        checkoutUrl: getCaktoCheckoutUrl() ?? null,
        caktoConfigurada: isCaktoConfigured(),
      };
    },
  );
