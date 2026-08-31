/**
 * Chamadas à API do Google Agenda (Calendar v3), por HTTP direto.
 *
 * A cota é o que dita o desenho aqui. O Google corta com 403/429 quando se
 * passa do limite por usuário, então:
 *
 *   - a leitura é incremental, com `syncToken`: depois da primeira vez, cada
 *     sincronização traz só o que mudou, e não a agenda inteira;
 *   - toda chamada tem repetição com espera crescente nos erros que são
 *     temporários (429, 403 de limite, 5xx) e desiste nos que não são;
 *   - o número de eventos por sincronização tem teto (`GOOGLE_MAX_EVENTOS_SYNC`).
 */
import { getGoogleSettings } from "../postgres/config.server";

/** Marca a tarefa dentro do evento: é como o evento é reconhecido na volta. */
export const TASK_ID_PROPERTY = "auraTaskId";

export type CalendarEventInput = {
  summary: string;
  description?: string | undefined;
  start: string;
  end: string;
  taskId: string;
};

export type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export class GoogleAuthError extends Error {}
/** O marcador de sincronização venceu: é preciso recomeçar do zero. */
export class SyncTokenExpiredError extends Error {}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(
  accessToken: string,
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<unknown> {
  const settings = getGoogleSettings();
  const url = new URL(`${settings.apiBaseUrl}/calendar/v3${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 204) return null;
    if (response.ok) return response.json().catch(() => null);

    const body = await response.text().catch(() => "");
    lastError = `${response.status} ${body.slice(0, 300)}`;

    if (response.status === 401)
      throw new GoogleAuthError("Acesso à agenda expirou ou foi revogado.");
    if (response.status === 410)
      throw new SyncTokenExpiredError("Marcador de sincronização venceu.");
    if (response.status === 404) return null;

    // 403 tanto pode ser cota (passa) quanto permissão (não adianta insistir).
    const rateLimited = response.status === 403 && /rateLimit|quota|userRateLimit/i.test(body);
    if (!RETRYABLE_STATUS.has(response.status) && !rateLimited) {
      throw new Error(`Google Agenda recusou a chamada: ${lastError}`);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 500);
  }

  throw new Error(`Google Agenda indisponível depois de ${MAX_ATTEMPTS} tentativas: ${lastError}`);
}

function body(input: CalendarEventInput) {
  const { timeZone } = getGoogleSettings();
  return JSON.stringify({
    summary: input.summary,
    description: input.description ?? undefined,
    start: { dateTime: input.start, timeZone },
    end: { dateTime: input.end, timeZone },
    extendedProperties: { private: { [TASK_ID_PROPERTY]: input.taskId } },
  });
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  return (await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: body(input),
  })) as CalendarEvent;
}

/**
 * Atualiza o evento. Quando ele não existe mais (apagado direto na agenda),
 * a chamada devolve `null` e quem chamou decide se cria outro.
 */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent | null> {
  return (await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT", body: body(input) },
  )) as CalendarEvent | null;
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

export type EventPage = {
  events: CalendarEvent[];
  /** Marcador para a próxima sincronização trazer só o que mudou. */
  nextSyncToken: string | undefined;
};

/**
 * Lê os eventos que mudaram. Com `syncToken`, o Google devolve só a diferença —
 * inclusive os cancelados, que é como uma exclusão feita na agenda chega aqui.
 * Sem ele (primeira vez), lê a janela de datas informada.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  options: { syncToken?: string | undefined; timeMin?: string; timeMax?: string },
): Promise<EventPage> {
  const settings = getGoogleSettings();
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const page = (await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: {
        showDeleted: "true",
        singleEvents: "true",
        maxResults: "250",
        pageToken,
        ...(options.syncToken
          ? { syncToken: options.syncToken }
          : { timeMin: options.timeMin, timeMax: options.timeMax }),
      },
    })) as { items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string } | null;

    events.push(...(page?.items ?? []));
    pageToken = page?.nextPageToken;
    nextSyncToken = page?.nextSyncToken ?? nextSyncToken;
  } while (pageToken && events.length < settings.maxEventsPerSync);

  return { events, nextSyncToken };
}
