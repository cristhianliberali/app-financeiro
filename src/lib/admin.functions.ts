import { createMiddleware, createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";
import type {
  EventoAdmin,
  MetricasAdmin,
  UsuarioAdmin,
} from "@/integrations/postgres/admin.server";
import type { HistoricoPlano } from "@/integrations/postgres/plano.server";
import { isStatusPlano, type StatusPlano } from "./plano";

export type { EventoAdmin, MetricasAdmin, UsuarioAdmin, HistoricoPlano };

/** Mensagem usada quando quem chama está logado mas não é super admin. */
export const SEM_ACESSO_ADMIN = "Área restrita";

/**
 * Exige super admin.
 *
 * A permissão é conferida no servidor a cada chamada, e não guardada na
 * sessão: tirar alguém do papel precisa valer na hora, não no próximo login.
 */
const requireSuperAdmin = createMiddleware({ type: "function" })
  .middleware([requireAuth])
  .server(async ({ next, context }) => {
    const { isSuperAdmin } = await import("@/integrations/postgres/plano.server");
    if (!(await isSuperAdmin(context.user))) throw new Error(SEM_ACESSO_ADMIN);
    return next({ context: { admin: context.user } });
  });

/**
 * Diz à tela se esta pessoa entra no painel.
 *
 * Existe para a rota `/admin` não precisar provocar um erro só para descobrir
 * que não pode entrar. Devolve `false` em vez de falhar — quem não é admin não
 * deve nem saber que a checagem existiu.
 */
export const souSuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<boolean> => {
    const { isSuperAdmin, sincronizarSuperAdmins } =
      await import("@/integrations/postgres/plano.server");
    // Promove quem está em SUPER_ADMIN_EMAILS e ainda não foi marcado no banco.
    await sincronizarSuperAdmins().catch(() => {});
    return isSuperAdmin(context.user);
  });

export const listarUsuariosAdmin = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { busca?: string; status?: string; pagina?: number }) => ({
    busca: (input?.busca ?? "").slice(0, 200),
    status: input?.status && isStatusPlano(input.status) ? input.status : "todos",
    pagina: Math.max(1, Math.trunc(input?.pagina ?? 1)),
  }))
  .handler(
    async ({ data }): Promise<{ itens: UsuarioAdmin[]; total: number; porPagina: number }> => {
      const { listarUsuarios } = await import("@/integrations/postgres/admin.server");
      const porPagina = 25;
      const resultado = await listarUsuarios({
        busca: data.busca,
        status: data.status as StatusPlano | "todos",
        limite: porPagina,
        offset: (data.pagina - 1) * porPagina,
      });
      return { ...resultado, porPagina };
    },
  );

export const lerMetricasAdmin = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .handler(
    async (): Promise<
      MetricasAdmin & {
        exigindoAssinatura: boolean;
        caktoConfigurada: boolean;
        apiConfigurada: boolean;
      }
    > => {
      const { lerMetricas } = await import("@/integrations/postgres/admin.server");
      const {
        getPlanoToleranciaDias,
        isPlanoObrigatorio,
        isCaktoConfigured,
        isCaktoApiConfigured,
      } = await import("@/integrations/postgres/config.server");

      return {
        ...(await lerMetricas(getPlanoToleranciaDias())),
        exigindoAssinatura: isPlanoObrigatorio(),
        caktoConfigurada: isCaktoConfigured(),
        apiConfigurada: isCaktoApiConfigured(),
      };
    },
  );

/**
 * Muda o plano de alguém na mão.
 *
 * É por aqui que passam a cortesia, a liberação de um pagamento que a Cakto não
 * confirmou e o bloqueio de quem não deveria estar dentro. Toda mudança grava
 * quem mandou e por quê — uma cortesia sem autor e sem motivo é indistinguível,
 * meses depois, de um bug que liberou alguém sozinho.
 */
export const definirPlanoAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .inputValidator(
    (input: {
      userId: string;
      status: string;
      codigoOferta?: string | null;
      expiraEm?: string | null;
      motivo?: string;
      observacao?: string | null;
    }) => {
      if (!input?.userId) throw new Error("Informe o usuário");
      if (!isStatusPlano(input?.status)) throw new Error("Status de plano inválido");

      // String vazia vinda de um campo em branco vira `null` (apagar o valor);
      // `undefined` continua significando "não mexer".
      const expiraEm =
        input.expiraEm === undefined ? undefined : input.expiraEm?.trim() ? input.expiraEm : null;
      if (expiraEm && Number.isNaN(new Date(expiraEm).getTime())) {
        throw new Error("Data de expiração inválida");
      }

      return {
        userId: input.userId,
        status: input.status,
        codigoOferta:
          input.codigoOferta === undefined
            ? undefined
            : input.codigoOferta?.trim()
              ? input.codigoOferta.trim()
              : null,
        expiraEm,
        motivo: (input.motivo ?? "").trim().slice(0, 500) || null,
        observacao:
          input.observacao === undefined
            ? undefined
            : input.observacao?.trim()
              ? input.observacao.trim().slice(0, 1000)
              : null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<UsuarioAdmin> => {
    const { aplicarPlano } = await import("@/integrations/postgres/plano.server");
    const { buscarUsuarioPorId } = await import("@/integrations/postgres/admin.server");

    await aplicarPlano({
      userId: data.userId,
      status: data.status,
      origem: "admin",
      atorId: context.admin.id,
      motivo: data.motivo,
      ...(data.codigoOferta !== undefined ? { codigoOferta: data.codigoOferta } : {}),
      ...(data.expiraEm !== undefined
        ? { expiraEm: data.expiraEm ? new Date(data.expiraEm) : null }
        : {}),
      ...(data.observacao !== undefined ? { observacao: data.observacao } : {}),
    });

    const atualizado = await buscarUsuarioPorId(data.userId);
    if (!atualizado) throw new Error("Usuário não encontrado");
    return atualizado;
  });

export const lerHistoricoAdmin = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("Informe o usuário");
    return { userId: input.userId };
  })
  .handler(async ({ data }): Promise<HistoricoPlano[]> => {
    const { lerHistorico } = await import("@/integrations/postgres/plano.server");
    return lerHistorico(data.userId);
  });

export const definirSuperAdminAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { userId: string; valor: boolean }) => {
    if (!input?.userId) throw new Error("Informe o usuário");
    return { userId: input.userId, valor: !!input?.valor };
  })
  .handler(async ({ data, context }): Promise<null> => {
    const { definirSuperAdmin, contarSuperAdmins } =
      await import("@/integrations/postgres/admin.server");

    // Um app sem nenhum super admin só volta a ter um por SQL na mão. A trava
    // vale inclusive para quem está se removendo — principalmente para ele.
    if (!data.valor && (await contarSuperAdmins()) <= 1) {
      throw new Error("Este é o último super admin; promova outra pessoa antes de removê-lo.");
    }
    if (!data.valor && data.userId === context.admin.id) {
      const { getSuperAdminEmails } = await import("@/integrations/postgres/config.server");
      if (getSuperAdminEmails().includes(context.admin.email.toLowerCase())) {
        throw new Error(
          "Seu e-mail está em SUPER_ADMIN_EMAILS: remova-o da variável de ambiente primeiro, " +
            "senão a permissão volta no próximo login.",
        );
      }
    }

    await definirSuperAdmin(data.userId, data.valor);
    return null;
  });

export const listarEventosAdmin = createServerFn({ method: "GET" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { situacao?: string; pagina?: number }) => ({
    situacao: input?.situacao ?? "todos",
    pagina: Math.max(1, Math.trunc(input?.pagina ?? 1)),
  }))
  .handler(
    async ({ data }): Promise<{ itens: EventoAdmin[]; total: number; porPagina: number }> => {
      const { listarEventos } = await import("@/integrations/postgres/admin.server");
      const porPagina = 20;
      const resultado = await listarEventos({
        situacao: data.situacao,
        limite: porPagina,
        offset: (data.pagina - 1) * porPagina,
      });
      return { ...resultado, porPagina };
    },
  );

/**
 * Reprocessa um evento guardado.
 *
 * É a razão de o corpo cru estar no banco. Um evento que ficou `sem_usuario`
 * porque a conta ainda não existia, ou `erro` por causa de um mapeamento que já
 * foi corrigido, volta a ser aplicado sem depender de reenvio da Cakto.
 */
export const reprocessarEventoAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { eventoId: string }) => {
    if (!input?.eventoId) throw new Error("Informe o evento");
    return { eventoId: input.eventoId };
  })
  .handler(async ({ data }): Promise<{ situacao: string; detalhe: string }> => {
    const { aplicarEvento } = await import("@/integrations/cakto/webhook.server");
    const resultado = await aplicarEvento(data.eventoId);
    return { situacao: resultado.situacao, detalhe: resultado.detalhe };
  });

/**
 * Testa as credenciais da API e mostra para onde a Cakto está mandando os
 * eventos. "Assinei e não liberou" quase sempre é um webhook apontando para o
 * lugar errado — esta é a tela que responde isso sem sair do app.
 */
export const testarConexaoCakto = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .handler(
    async (): Promise<{
      ok: boolean;
      mensagem: string;
      webhooks: { url: string; ativo: boolean }[];
    }> => {
      const { isCaktoApiConfigured } = await import("@/integrations/postgres/config.server");
      if (!isCaktoApiConfigured()) {
        return {
          ok: false,
          mensagem:
            "CAKTO_CLIENT_ID e CAKTO_CLIENT_SECRET não estão configurados. " +
            "O webhook funciona sem eles; este teste, não.",
          webhooks: [],
        };
      }

      const { listarWebhooks } = await import("@/integrations/cakto/api.server");
      try {
        const webhooks = await listarWebhooks();
        return {
          ok: true,
          mensagem: `Conexão ok. ${webhooks.length} webhook(s) cadastrado(s) na Cakto.`,
          webhooks: webhooks.map((w) => ({ url: String(w.url ?? "—"), ativo: w.active !== false })),
        };
      } catch (error) {
        return {
          ok: false,
          mensagem: error instanceof Error ? error.message : String(error),
          webhooks: [],
        };
      }
    },
  );

/**
 * Gera uma senha provisória nova e reenvia o e-mail de acesso.
 *
 * A saída para quando o e-mail automático da compra não chegou — o webhook já
 * marcou o acesso como entregue, então reprocessar o evento não reenviaria nada.
 */
export const reenviarAcessoAdmin = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("Informe o usuário");
    return { userId: input.userId };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; detalhe: string }> => {
    const { reenviarAcesso } = await import("@/integrations/cakto/provisionamento.server");
    return reenviarAcesso({ userId: data.userId, atorId: context.admin.id });
  });
