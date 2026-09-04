import { useQuery } from "@tanstack/react-query";

import { getAcesso, type Acesso } from "@/lib/plano.functions";

export type AcessoCliente = Acesso & { checkoutUrl: string | null; caktoConfigurada: boolean };

export const ACESSO_QUERY_KEY = ["plano", "acesso"] as const;

/**
 * Estado da assinatura de quem está logado.
 *
 * A tela usa isto para não mostrar o app a quem não tem acesso. Não é a trava:
 * a trava está no servidor, em `requirePlano`. Aqui é só para a pessoa ver a
 * explicação certa em vez de uma tela quebrada — se este hook fosse a única
 * defesa, bastaria chamar a server function direto para contorná-la.
 *
 * `staleTime` curto de propósito: quem acabou de pagar volta do checkout
 * esperando o app aberto, e o webhook chega em segundos.
 */
export function useAcesso(habilitado = true) {
  return useQuery<AcessoCliente>({
    queryKey: ACESSO_QUERY_KEY,
    queryFn: () => getAcesso(),
    enabled: habilitado,
    staleTime: 30 * 1000,
    retry: false,
  });
}
