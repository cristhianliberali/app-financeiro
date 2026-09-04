import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint que a Cakto chama. Cadastre esta URL no painel dela:
 *
 *   https://SEU-DOMINIO/api/cakto/webhook
 *
 * Autenticação: o segredo configurado no painel da Cakto vem no corpo
 * (`secret`) e é conferido contra `CAKTO_WEBHOOK_SECRET`. Aceitamos também por
 * cabeçalho (`x-cakto-secret` / `x-webhook-secret`), que é onde alguns painéis
 * o colocam. Sem a variável configurada a rota recusa tudo com 503: um endereço
 * que muda o acesso de qualquer pessoa não pode ficar aberto enquanto ninguém
 * terminou de configurá-lo.
 *
 * Códigos de resposta, e o porquê de cada um:
 *
 *   200  recebido (aplicado, ignorado, duplicado ou guardado sem dono).
 *        O corpo está gravado; reentregar não ajudaria em nada.
 *   401  segredo errado. Aqui a reentrega faz sentido, depois de corrigido.
 *   503  o app ainda não sabe qual é o segredo.
 *
 * O 200 em "ignorado" é a decisão menos óbvia e a mais importante: um evento
 * que ainda não sabemos traduzir não é uma falha de entrega. Devolver erro faria
 * a Cakto reenviar por horas um corpo que já está no nosso banco, esperando que
 * alguém olhe a tela de eventos do painel.
 */
export const Route = createFileRoute("/api/cakto/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getCaktoSettings, isCaktoConfigured } =
          await import("@/integrations/postgres/config.server");

        if (!isCaktoConfigured()) {
          return json(503, {
            ok: false,
            erro: "CAKTO_WEBHOOK_SECRET não configurado no serviço.",
          });
        }

        const { conferirSegredo, segredoDoCorpo } = await import("@/integrations/cakto/contrato");

        let corpo: unknown;
        try {
          corpo = await request.json();
        } catch {
          return json(400, { ok: false, erro: "Corpo inválido: esperado JSON." });
        }

        const esperado = getCaktoSettings().webhookSecret;
        const recebido =
          segredoDoCorpo(corpo) ??
          request.headers.get("x-cakto-secret") ??
          request.headers.get("x-webhook-secret");

        if (!conferirSegredo(recebido, esperado)) {
          console.warn("[cakto] webhook recusado: segredo não confere");
          return json(401, { ok: false, erro: "Segredo inválido." });
        }

        const { receberWebhook } = await import("@/integrations/cakto/webhook.server");

        try {
          const resultado = await receberWebhook(corpo);
          console.info(
            `[cakto] webhook ${resultado.situacao}${resultado.duplicado ? " (duplicado)" : ""}: ${resultado.detalhe}`,
          );
          return json(200, { ok: true, ...resultado });
        } catch (error) {
          // Falha nossa (banco fora, por exemplo). Aqui a reentrega ajuda, então
          // é o único caso em que pedimos que a Cakto tente de novo.
          const detalhe = error instanceof Error ? error.message : String(error);
          console.error("[cakto] falha ao processar webhook:", detalhe);
          return json(500, { ok: false, erro: detalhe });
        }
      },
    },
  },
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
