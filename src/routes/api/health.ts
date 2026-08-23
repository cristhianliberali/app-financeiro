import { createFileRoute } from "@tanstack/react-router";

// Endpoint de health check usado pelo EasyPanel para saber se o container
// subiu. Responde sem tocar no Supabase, então continua 200 mesmo que o banco
// esteja fora — o objetivo é checar o processo Node, não as dependências.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ status: "ok", uptime: process.uptime() }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
    },
  },
});
