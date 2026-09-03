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

/** Como o Google falso responde a um pedido de criação de compromisso. */
let criarEvento: (corpo: { summary?: string }) => Response = (corpo) =>
  Response.json({ id: `evento-${corpo.summary}` });

/**
 * Páginas extras que a listagem devolve antes da última.
 *
 * O Google só manda `nextSyncToken` na última página — é isto que permite
 * provar que uma agenda paginada não perde o marcador pelo caminho.
 */
let paginasExtras = 0;
let paginasPedidas = 0;

const google = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/events")) {
      if (request.method === "POST") {
        return criarEvento((await request.json()) as { summary?: string });
      }
      lastListQuery = url.searchParams;
      paginasPedidas += 1;
      if (paginasPedidas <= paginasExtras) {
        // Página intermediária: tem continuação e não tem marcador.
        return Response.json({ items: googleEvents, nextPageToken: `pagina-${paginasPedidas}` });
      }
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
/** Tarefas que a fila de envio devolve, na ordem. */
let fila: Array<{ id: string; title: string }> = [];
const written: Array<{ sql: string; params: readonly unknown[] }> = [];

function responder(sql: string, params: readonly unknown[]): unknown[] {
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
  // A fila de envio, reconhecida pelo JOIN que só ela tem.
  if (sql.includes("board_statuses")) return fila.map((tarefa) => ({ id: tarefa.id }));
  // `loadTask`: a tarefa inteira, com quadro e espaço.
  if (sql.includes("JOIN boards b")) {
    const tarefa = fila.find((t) => t.id === params[0]);
    return tarefa
      ? [
          {
            id: tarefa.id,
            title: tarefa.title,
            description: null,
            responsible_user_id: USER,
            start_date: null,
            due_date: new Date("2026-09-10T14:00:00"),
            board_name: "Quadro",
            space_name: "Espaço",
          },
        ]
      : [];
  }
  // Vínculos de uma tarefa só (o envio) — a lista do usuário vem depois.
  if (sql.includes("FROM task_calendar_events WHERE task_id")) return [];
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
    return responder(sql, params);
  },
  queryOne: async (sql: string, params: readonly unknown[] = []) => {
    if (sql.trimStart().toUpperCase().startsWith("UPDATE")) written.push({ sql, params });
    return responder(sql, params)[0] ?? null;
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
  fila = [];
  lastListQuery = undefined;
  paginasExtras = 0;
  paginasPedidas = 0;
  criarEvento = (corpo) => Response.json({ id: `evento-${corpo.summary}` });
}

/** O que foi gravado em `google_accounts.sync_token` na última rodada. */
const marcadorGravado = () =>
  written.find((w) => w.sql.includes("SET sync_token"))?.params[1] ?? null;

const datasGravadas = () => written.find((w) => w.sql.includes("UPDATE tasks SET start_date"));

describe("syncUser", () => {
  test("lê a agenda antes de enviar, para não duplicar o compromisso órfão", async () => {
    cenario({ comToken: true });
    // O compromisso existe na agenda com a nossa marca, mas sem vínculo — é o
    // que sobra de desconectar e reconectar. Enviando primeiro, a tarefa
    // ganharia um compromisso novo e a edição desta seria descartada.
    links = [];
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    const resultado = await googleServer.syncUser(USER);

    expect(resultado.updated).toBe(1);
    expect(datasGravadas()!.params[2]).toEqual(new Date("2026-09-11T16:00:00"));
  });
});

describe("pushPendingTasks", () => {
  test("tarefa recusada pelo Google não derruba as outras da fila", async () => {
    cenario({ comToken: true });
    // Era este o defeito em produção: a segunda tarefa parava a fila, e a
    // terceira — e todas as criadas depois dela — nunca ganhavam compromisso.
    fila = [
      { id: "aaaaaaaa-0000-0000-0000-000000000001", title: "boa 1" },
      { id: "aaaaaaaa-0000-0000-0000-000000000002", title: "ruim" },
      { id: "aaaaaaaa-0000-0000-0000-000000000003", title: "boa 2" },
    ];
    criarEvento = (corpo) =>
      corpo.summary === "ruim"
        ? Response.json({ error: { message: "Invalid value for: start" } }, { status: 400 })
        : Response.json({ id: `evento-${corpo.summary}` });

    const resultado = await googleServer.pushPendingTasks(USER);

    expect(resultado.pushed).toBe(2);
    expect(resultado.refused).toBe(1);
    // O erro devolvido é o que mantém o aviso do perfil de pé, e ele precisa
    // nomear a tarefa: a mensagem do Google sozinha não diz o que corrigir.
    expect(resultado.error).toContain("ruim");
  });

  test("a tarefa recusada fica registrada na trilha, para sair da fila", async () => {
    cenario({ comToken: true });
    fila = [{ id: "aaaaaaaa-0000-0000-0000-000000000002", title: "ruim" }];
    criarEvento = () => Response.json({ error: {} }, { status: 400 });

    await googleServer.pushPendingTasks(USER);

    expect(written.some((w) => w.params.includes("calendar_event_failed"))).toBe(true);
  });

  test("recusa que vale para todos (401) para a rodada na primeira tarefa", async () => {
    cenario({ comToken: true });
    fila = [
      { id: "aaaaaaaa-0000-0000-0000-000000000001", title: "boa 1" },
      { id: "aaaaaaaa-0000-0000-0000-000000000003", title: "boa 2" },
    ];
    criarEvento = () => new Response("unauthorized", { status: 401 });

    const resultado = await googleServer.pushPendingTasks(USER);

    expect(resultado.pushed).toBe(0);
    expect(resultado.refused).toBe(0);
    expect(resultado.error).toBeDefined();
    // Acesso revogado não é defeito da tarefa: ela não pode ser tirada da fila.
    expect(written.some((w) => w.params.includes("calendar_event_failed"))).toBe(false);
  });
});

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

  test("agenda paginada não perde o marcador incremental", async () => {
    cenario({ comToken: false });
    // Primeira leitura de uma agenda cheia: três páginas até a última, que é a
    // única que traz `nextSyncToken`. O teto de eventos por rodada é atingido
    // logo na primeira — e era aí que a leitura parava, deixando a conta sem
    // marcador. Sem marcador, toda rodada relia tudo de novo e nunca alcançava
    // os eventos além do teto: a agenda simplesmente não voltava para as
    // tarefas, sem um único erro no caminho.
    process.env["GOOGLE_MAX_EVENTOS_SYNC"] = "1";
    paginasExtras = 2;
    googleEvents = [evento("2026-09-11T16:00:00", "2026-09-11T17:00:00", "2026-09-10T09:00:00")];

    try {
      await googleServer.pullCalendarChanges(USER);
    } finally {
      delete process.env["GOOGLE_MAX_EVENTOS_SYNC"];
    }

    expect(paginasPedidas).toBe(3);
    expect(marcadorGravado()).toBe("token-novo");
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

/**
 * A rodada acionada por HTTP: é o que garante a sincronização quando o
 * `setInterval` de dentro do processo não sobe — sem tráfego autenticado, ou
 * com o processo reiniciado.
 */
describe("handleSyncRequest", () => {
  const pedido = (headers?: Record<string, string>) =>
    new Request("http://local/api/google/sync", { method: "POST", headers });

  async function rota() {
    return import("../src/integrations/postgres/calendar-scheduler.server");
  }

  test("sem GOOGLE_SYNC_TOKEN a rota fica fechada", async () => {
    cenario({ comToken: true });
    delete process.env["GOOGLE_SYNC_TOKEN"];

    const resposta = await (await rota()).handleSyncRequest(pedido());

    expect(resposta.status).toBe(503);
  });

  test("segredo errado não dispara rodada nenhuma", async () => {
    cenario({ comToken: true });
    process.env["GOOGLE_SYNC_TOKEN"] = "segredo-do-cron";

    const resposta = await (
      await rota()
    ).handleSyncRequest(pedido({ authorization: "Bearer outro-segredo" }));

    expect(resposta.status).toBe(401);
    expect(lastListQuery).toBeUndefined();
  });

  test("com o segredo, roda e devolve o resumo", async () => {
    cenario({ comToken: true });
    process.env["GOOGLE_SYNC_TOKEN"] = "segredo-do-cron";

    const resposta = await (
      await rota()
    ).handleSyncRequest(pedido({ authorization: "Bearer segredo-do-cron" }));

    expect(resposta.status).toBe(200);
    const resumo = (await resposta.json()) as { usuarios: number; falhas: unknown[] };
    expect(resumo.usuarios).toBe(1);
    expect(resumo.falhas).toEqual([]);
  });
});
