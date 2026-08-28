import { createFileRoute } from "@tanstack/react-router";

// Endpoint de health check usado pelo EasyPanel para saber se o container
// subiu. Por padrão responde sem tocar no banco, então continua 200 mesmo que
// o Postgres esteja fora — o objetivo é checar o processo Node, não as
// dependências. Use `/api/health?db=1` para incluir um ping no Postgres; aí a
// resposta é 503 quando o banco não responde.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const checkDb = new URL(request.url).searchParams.get("db") === "1";
        const database = checkDb
          ? await (await import("@/integrations/postgres/client.server")).pingDatabase()
          : undefined;

        return new Response(
          JSON.stringify({
            status: database === false ? "degraded" : "ok",
            uptime: process.uptime(),
            ...(database === undefined ? {} : { database: database ? "up" : "down" }),
          }),
          {
            status: database === false ? 503 : 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
