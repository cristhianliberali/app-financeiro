import { createFileRoute } from "@tanstack/react-router";

/**
 * Retorno do consentimento do Google.
 *
 * O Google manda o usuário de volta para cá com um código de autorização, que
 * é trocado por tokens no servidor — o navegador nunca vê nem o código nem o
 * segredo do cliente. O `state` é conferido contra o cookie gravado quando a
 * conexão começou: sem isso, um link forjado poderia ligar a agenda de um
 * estranho à conta de quem clicasse.
 */
export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const { finishGoogleConnection } =
          await import("@/integrations/postgres/google-oauth.server");
        const result = await finishGoogleConnection({ code, state, error });

        return new Response(null, {
          status: 302,
          headers: { location: result.redirectTo, "cache-control": "no-store" },
        });
      },
    },
  },
});
