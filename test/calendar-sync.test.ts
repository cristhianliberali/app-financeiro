import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

/**
 * A leitura da agenda de ponta a ponta, sem Google e sem Postgres de verdade.
 *
 * Os testes de `event-dates` provam a conversão das datas; este prova o que
 * está em volta dela — a chamada HTTP montada, o casamento do evento com o
 * vínculo da tarefa e o UPDATE que sai no fim. Era exatamente aí que estava o
 * defeito que nenhum teste de unidade pegaria: a rodada terminava sem erro e
 * sem escrever nada.
 *
 * O Google é um servidor local (a variável `GOOGLE_API_BASE_URL` existe para
 * isto) e o banco é uma função que responde por trecho de SQL.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const TASK = "22222222-2222-2222-2222-222222222222";
const EVENT = "evento-abc";

/** O que o Google falso devolve na próxima leitura. */
let googleEvents: unknown[] = [];
const nextSyncToken: string | undefined = "token-novo";
/** Query string da última listagem — é como se confere o que foi pedido. */
let lastListQuery: URLSearchParams | undefined;

const google = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/events")) {
      lastListQuery = url.searchParams;
      return Response.json({ items: googleEvents, nextSyncToken });
    }
    return new Response("not found", { status: 404 });
  },
});

process.env["GOOGLE_CLIENT_ID"] = "id-de-teste";
process.env["GOOGLE_CLIENT_SECRET"] = "segredo-de-teste";
process.env["GOOGLE_API_BASE_URL"] = `http://127.0.0.1:${google.port}`;

/** Estado do "banco": o que as consultas devolvem e o que foi escrito nele. */
let taskDates: { start_date: Date | null; due_date: Date | null };
let links: Array<{ task_id: string; event_id: string; synced_at: Date }>;
let syncToken: string | null;
const written: Array<{ sql: string; params: readonly unknown[] }> = [];

function responder(sql: string): unknown[] {
  if (sql.includes("FROM google_accounts")) {
    return [
      {
        user_id: USER,
        google_email: "eu@exemplo.com",
        calendar_id: "primary",
        access_token: encriptado,
        refresh_token: encriptado,
        // No futuro: evita a renovação de token, que falaria com o Google falso.
        expires_at: new Date(Date.now() + 3_600_000),
        sync_token: syncToken,
        last_sync_at: null,
        last_error: null,
      },
    ];
  }
  if (sql.includes("FROM task_calendar_events")) return links;
  if (sql.includes("FROM tasks WHERE id")) return [taskDates];
  return [];
}

let encriptado = "";

mock.module("../src/integrations/postgres/client.server", () => ({
  query: async (sql: string, params: readonly unknown[] = []) => {
    if (sql.trimStart().toUpperCase().startsWith("UPDATE") || sql.includes("INSERT")) {
      written.push({ sql, params });
    }
    return responder(sql);
  },
  queryOne: async (sql: string, params: readonly unknown[] = []) => {
    if (sql.trimStart().toUpperCase().startsWith("UPDATE")) written.push({ sql, params });
    return responder(sql)[0] ?? null;
  },
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  getPool: () => {
    throw new Error("o teste não deve abrir conexão de verdade");
  },
}));

type Sync = typeof import("../src/integrations/postgres/google.server");
let googleServer: Sync;

beforeAll(async () => {
  const { encryptToken } = await import("../src/integrations/google/crypto.server");
  encriptado = encryptToken("token-de-acesso");
  googleServer = await import("../src/integrations/postgres/google.server");
});

afterAll(() => google.stop(true));

/** Um compromisso como o Google o devolve. */
function evento(start: string, end: string, updated: string) {
  return {
    id: EVENT,
    status: "confirmed",
    summary: "Tarefa de teste",
    updated: new Date(updated).toISOString(),
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(end).toISOString() },
    extendedProperties: { private: { auraTaskId: TASK } },
  };
}

/** Deixa o cenário no estado inicial: tarefa às 14h, compromisso espelhando-a. */
function cenario({ comToken }: { comToken: boolean }) {
  written.length = 0;
  taskDates = { start_date: null, due_date: new Date("2026-09-10T14:00:00") };
  links = [{ task_id: TASK, event_id: EVENT, synced_at: new Date("2026-09-09T08:00:00") }];
  syncToken = comToken ? "token-anterior" : null;
  googleEvents = [];
}

const datasGravadas = () => written.find((w) => w.sql.includes("UPDATE tasks SET start_date"));

describe("pullCalendarChanges", () => {
  test("compromisso movido no Google grava a data nova na tarefa", async () => {
    cenario({ comToken: true });
    // A pessoa arrastou o compromisso do dia 10 às 14h para o dia 11 às 16h.
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(1);
    const update = datasGravadas();
    expect(update).toBeDefined();
    expect(update!.params[2]).toEqual(new Date("2026-09-11T16:00:00"));
  });

  test("a leitura incremental não manda janela de datas junto do marcador", async () => {
    cenario({ comToken: true });
    await googleServer.pullCalendarChanges(USER);

    // O Google recusa `timeMin`/`timeMax` junto de `syncToken` com erro 400.
    expect(lastListQuery?.get("syncToken")).toBe("token-anterior");
    expect(lastListQuery?.get("timeMin")).toBeNull();
    expect(lastListQuery?.get("timeMax")).toBeNull();
  });

  test("o eco da própria escrita do app não grava nada", async () => {
    cenario({ comToken: true });
    // Mesma janela que a tarefa produz: prazo às 14h + a hora padrão.
    googleEvents = [evento("2026-09-10T14:00:00", "2026-09-10T15:00:00", "2026-09-11T10:00:00")];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(0);
    expect(datasGravadas()).toBeUndefined();
  });

  test("edição logo depois da nossa escrita entra, mesmo com o relógio do servidor adiantado", async () => {
    cenario({ comToken: true });
    // `synced_at` (Postgres) bem à frente de `updated` (Google): é o relógio
    // torto que engolia a edição em silêncio.
    links = [{ task_id: TASK, event_id: EVENT, synced_at: new Date("2026-09-20T08:00:00") }];
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(1);
  });

  test("na leitura completa, o evento defasado não desfaz a data mais nova", async () => {
    cenario({ comToken: false });
    links = [{ task_id: TASK, event_id: EVENT, synced_at: new Date("2026-09-20T08:00:00") }];
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(0);
  });

  test("compromisso apagado limpa as datas da tarefa", async () => {
    cenario({ comToken: true });
    googleEvents = [{ id: EVENT, status: "cancelled" }];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.cleared).toBe(1);
    expect(written.some((w) => w.sql.includes("start_date = NULL"))).toBe(true);
  });

  test("evento sem a nossa marca não mexe em nada", async () => {
    cenario({ comToken: true });
    links = [];
    // Uma reunião qualquer da agenda: sem `auraTaskId`, não é espelho de tarefa.
    const { extendedProperties: _, ...reuniao } = evento(
      "2026-09-11T16:00:00",
      "2026-09-11T17:00:00",
      "2026-09-10T09:00:00",
    );
    googleEvents = [reuniao];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(0);
    expect(datasGravadas()).toBeUndefined();
  });

  test("compromisso nosso que perdeu o vínculo é readotado e volta a valer", async () => {
    cenario({ comToken: true });
    // É o que sobra de desconectar e reconectar a conta: o evento continua na
    // agenda, com a nossa marca, mas o vínculo no banco foi apagado.
    links = [];
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(1);
    expect(written.some((w) => w.sql.includes("INSERT INTO task_calendar_events"))).toBe(true);
    expect(datasGravadas()!.params[2]).toEqual(new Date("2026-09-11T16:00:00"));
  });

  test("cópia duplicada não briga com o compromisso que já vale", async () => {
    cenario({ comToken: true });
    // A tarefa já tem um compromisso vivo; esta é uma cópia com a mesma marca.
    const copia = {
      ...evento("2026-09-20T10:00:00", "2026-09-20T11:00:00", "2026-09-19T09:00:00"),
    };
    copia.id = "copia-do-evento";
    googleEvents = [copia];

    const resultado = await googleServer.pullCalendarChanges(USER);

    expect(resultado.updated).toBe(0);
    expect(datasGravadas()).toBeUndefined();
  });
});
