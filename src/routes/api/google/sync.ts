import { createFileRoute } from "@tanstack/react-router";

/**
 * Dispara uma rodada de sincronização da agenda, de fora do processo.
 *
 * Existe porque o agendador é um `setInterval` dentro do servidor web, levantado
 * pelo primeiro acesso autenticado: sem tráfego ele não sobe, com várias
 * réplicas cada uma roda o seu, e de fora não há como saber se algum deles está
 * vivo. Esta rota resolve as três coisas de uma vez — um cron do painel de
 * deploy garante a execução, e a resposta em JSON diz, com números, o que a
 * rodada fez.
 *
 * O acesso é por `GOOGLE_SYNC_TOKEN`. Sem a variável a rota responde 503: um
 * endereço que dispara trabalho para todos os usuários conectados não pode
 * ficar aberto, e não há padrão razoável para inventar aqui.
 */
export const Route = createFileRoute("/api/google/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSyncRequest } =
          await import("@/integrations/postgres/calendar-scheduler.server");
        return handleSyncRequest(request);
      },
    },
  },
});
