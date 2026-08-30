import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

export type GoogleStatus = {
  /** O servidor tem credenciais do Google Cloud configuradas? */
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type AgendaEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  /** Preenchido quando o compromisso nasceu de uma tarefa do app. */
  taskId?: string;
  link?: string;
};

function requireDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} deve ser uma data no formato AAAA-MM-DD`);
  }
  return value;
}

export const getGoogleStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<GoogleStatus> => {
    const { isGoogleConfigured } = await import("@/integrations/postgres/config.server");
    if (!isGoogleConfigured()) {
      return {
        configured: false,
        connected: false,
        email: null,
        lastSyncAt: null,
        lastError: null,
      };
    }

    const { getConnection } = await import("@/integrations/postgres/google.server");
    const connection = await getConnection(context.user.id);

    return {
      configured: true,
      connected: !!connection,
      email: connection?.google_email ?? null,
      lastSyncAt: connection?.last_sync_at ? new Date(connection.last_sync_at).toISOString() : null,
      lastError: connection?.last_error ?? null,
    };
  });

/** Devolve a URL de consentimento; quem redireciona é o navegador. */
export const startGoogleConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ url: string }> => {
    const { startGoogleConnection: run } =
      await import("@/integrations/postgres/google-oauth.server");
    return { url: await run() };
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<null> => {
    const { disconnect } = await import("@/integrations/postgres/google.server");
    await disconnect(context.user.id);
    return null;
  });

/** Botão "sincronizar agora" do painel. */
export const syncGoogleNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<{ cleared: number; read: number }> => {
    const { syncUser } = await import("@/integrations/postgres/google.server");
    return syncUser(context.user.id);
  });

/** Compromissos da agenda numa janela de datas, para o calendário do painel. */
export const fetchAgendaEvents = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { from: string; to: string }) => ({
    from: requireDate(input?.from, "from"),
    to: requireDate(input?.to, "to"),
  }))
  .handler(async ({ data, context }): Promise<AgendaEvent[]> => {
    const { getConnection, listCalendarEvents } =
      await import("@/integrations/postgres/google.server");
    if (!(await getConnection(context.user.id))) return [];

    try {
      return await listCalendarEvents(context.user.id, data);
    } catch (error) {
      // A agenda fora do ar não pode derrubar o painel inteiro.
      console.error("[agenda] não foi possível listar os compromissos:", error);
      return [];
    }
  });
