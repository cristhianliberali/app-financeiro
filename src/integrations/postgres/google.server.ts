/**
 * Sincronização das tarefas com o Google Agenda.
 *
 * A ligação é por pessoa: cada usuário conecta a própria conta, e a tarefa vira
 * compromisso na agenda de quem é responsável por ela. Tarefa sem responsável,
 * responsável sem conta conectada ou tarefa sem data não viram evento — e, se
 * já tinham um, ele é removido.
 *
 * Nos dois sentidos, mas não simétricos, porque as pontas não são iguais:
 *
 *   app → agenda: criar, editar e excluir a tarefa mexem no evento;
 *   agenda → app: apagar o compromisso limpa as datas da tarefa, sem apagá-la.
 *     A tarefa é o registro de trabalho; a agenda é só onde ele aparece no dia.
 *
 * Toda mudança feita por aqui fica na trilha da tarefa (`task_activity`), que é
 * onde se descobre depois por que uma data sumiu.
 */
import { query, queryOne } from "./client.server";
import { decryptToken, encryptToken } from "../google/crypto.server";
import { refreshAccessToken, type GoogleTokens } from "../google/oauth.server";
import {
  GoogleAuthError,
  SyncTokenExpiredError,
  TASK_ID_PROPERTY,
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type CalendarEvent,
} from "../google/calendar.server";

export type GoogleConnection = {
  user_id: string;
  google_email: string;
  calendar_id: string;
  access_token: string | null;
  refresh_token: string;
  expires_at: Date | null;
  sync_token: string | null;
  last_sync_at: Date | null;
  last_error: string | null;
};

/** Duração padrão de um compromisso quando a tarefa tem só uma data. */
const DEFAULT_EVENT_MINUTES = 60;

// ───────────────────────────── conexão ──────────────────────────────────

export async function getConnection(userId: string): Promise<GoogleConnection | null> {
  return queryOne<GoogleConnection>(
    `SELECT user_id, google_email, calendar_id, access_token, refresh_token, expires_at,
            sync_token, last_sync_at, last_error
       FROM google_accounts WHERE user_id = $1`,
    [userId],
  );
}

/** Guarda (ou atualiza) a conexão. Os tokens são cifrados antes de gravar. */
export async function saveConnection(
  userId: string,
  tokens: GoogleTokens & { calendarId?: string },
): Promise<void> {
  if (!tokens.refreshToken) {
    // Sem refresh token a conexão morreria em uma hora. Acontece quando o
    // usuário já havia autorizado antes e o Google não reenvia o token.
    const existing = await getConnection(userId);
    if (!existing) {
      throw new Error(
        "O Google não devolveu a autorização de longa duração. Remova o acesso do app em " +
          "myaccount.google.com/permissions e conecte de novo.",
      );
    }
  }

  await query(
    `INSERT INTO google_accounts (user_id, google_email, calendar_id, access_token,
                                  refresh_token, expires_at, last_error)
     VALUES ($1, $2, COALESCE($3, 'primary'), $4, $5, $6, NULL)
     ON CONFLICT (user_id) DO UPDATE
        SET google_email  = EXCLUDED.google_email,
            calendar_id   = EXCLUDED.calendar_id,
            access_token  = EXCLUDED.access_token,
            refresh_token = COALESCE(EXCLUDED.refresh_token, google_accounts.refresh_token),
            expires_at    = EXCLUDED.expires_at,
            last_error    = NULL`,
    [
      userId,
      tokens.email ?? "",
      tokens.calendarId ?? null,
      encryptToken(tokens.accessToken),
      tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      tokens.expiresAt,
    ],
  );
}

export async function disconnect(userId: string): Promise<void> {
  // Os eventos ficam na agenda: apagá-los ao desconectar seria apagar o que a
  // pessoa já organizou. O que sai é a ligação.
  await query(`DELETE FROM task_calendar_events WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM google_accounts WHERE user_id = $1`, [userId]);
}

async function markError(userId: string, message: string): Promise<void> {
  await query(`UPDATE google_accounts SET last_error = $2 WHERE user_id = $1`, [
    userId,
    message.slice(0, 500),
  ]);
}

/** Token válido para chamar a API, renovando quando estiver perto de vencer. */
async function accessTokenFor(connection: GoogleConnection): Promise<string> {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 60_000) {
    return decryptToken(connection.access_token);
  }

  const renewed = await refreshAccessToken(decryptToken(connection.refresh_token));
  await query(
    `UPDATE google_accounts SET access_token = $2, expires_at = $3, last_error = NULL
      WHERE user_id = $1`,
    [connection.user_id, encryptToken(renewed.accessToken), renewed.expiresAt],
  );
  return renewed.accessToken;
}

// ─────────────────────────── app → agenda ───────────────────────────────

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  responsible_user_id: string | null;
  start_date: Date | null;
  due_date: Date | null;
  board_name: string;
  space_name: string;
};

type LinkRow = { user_id: string; event_id: string; calendar_id: string };

async function logCalendar(
  taskId: string,
  userId: string | null,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)`,
    [taskId, userId, action, JSON.stringify(meta)],
  ).catch((error) => console.error("[agenda] não foi possível registrar a atividade:", error));
}

/** Janela do compromisso a partir das datas da tarefa. */
function windowOf(task: TaskRow): { start: string; end: string } | null {
  const start = task.start_date ?? task.due_date;
  if (!start) return null;

  const startAt = new Date(start);
  const endCandidate = task.due_date ? new Date(task.due_date) : null;
  const endAt =
    endCandidate && endCandidate.getTime() > startAt.getTime()
      ? endCandidate
      : new Date(startAt.getTime() + DEFAULT_EVENT_MINUTES * 60_000);

  return { start: startAt.toISOString(), end: endAt.toISOString() };
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  return queryOne<TaskRow>(
    `SELECT t.id, t.title, t.description, t.responsible_user_id, t.start_date, t.due_date,
            b.name AS board_name, s.name AS space_name
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       JOIN spaces s ON s.id = b.space_id
      WHERE t.id = $1`,
    [taskId],
  );
}

async function dropEvent(
  taskId: string,
  link: LinkRow,
  reason: string,
  /** Falso quando a própria tarefa já foi excluída: não há mais onde registrar. */
  keepLog = true,
): Promise<void> {
  const connection = await getConnection(link.user_id);
  if (connection) {
    try {
      await deleteEvent(await accessTokenFor(connection), link.calendar_id, link.event_id);
    } catch (error) {
      console.error("[agenda] não foi possível apagar o evento:", error);
    }
  }
  await query(`DELETE FROM task_calendar_events WHERE task_id = $1 AND user_id = $2`, [
    taskId,
    link.user_id,
  ]);
  if (keepLog) await logCalendar(taskId, link.user_id, "calendar_event_deleted", { reason });
}

/**
 * Põe a agenda de acordo com o estado atual da tarefa: cria, atualiza ou apaga
 * o evento. É chamada depois de criar, editar e excluir uma tarefa, e também
 * pela sincronização periódica.
 */
export async function syncTaskToCalendar(taskId: string): Promise<void> {
  const task = await loadTask(taskId);
  const links = await query<LinkRow>(
    `SELECT user_id, event_id, calendar_id FROM task_calendar_events WHERE task_id = $1`,
    [taskId],
  );

  // Tarefa apagada: some da agenda de quem a tivesse.
  if (!task) {
    for (const link of links) await dropEvent(taskId, link, "tarefa excluída", false);
    return;
  }

  const owner = task.responsible_user_id;
  const window = windowOf(task);

  // Evento de quem não é mais o responsável — ou de quando a tarefa perdeu as
  // datas — sai da agenda.
  for (const link of links) {
    if (!owner || link.user_id !== owner || !window) {
      await dropEvent(taskId, link, !window ? "tarefa sem data" : "responsável mudou");
    }
  }

  if (!owner || !window) return;

  const connection = await getConnection(owner);
  if (!connection) return;

  const input = {
    summary: task.title,
    description: [task.description?.trim(), `${task.space_name} › ${task.board_name}`]
      .filter(Boolean)
      .join("\n\n"),
    start: window.start,
    end: window.end,
    taskId,
  };

  try {
    const accessToken = await accessTokenFor(connection);
    const current = links.find((link) => link.user_id === owner);

    if (current) {
      const updated = await updateEvent(accessToken, current.calendar_id, current.event_id, input);
      if (updated) {
        await query(
          `UPDATE task_calendar_events SET synced_at = now() WHERE task_id = $1 AND user_id = $2`,
          [taskId, owner],
        );
        await logCalendar(taskId, owner, "calendar_event_updated", { event_id: current.event_id });
        return;
      }
      // Evento sumiu da agenda: o vínculo antigo não vale mais.
      await query(`DELETE FROM task_calendar_events WHERE task_id = $1 AND user_id = $2`, [
        taskId,
        owner,
      ]);
    }

    const created = await createEvent(accessToken, connection.calendar_id, input);
    await query(
      `INSERT INTO task_calendar_events (task_id, user_id, event_id, calendar_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, user_id) DO UPDATE SET event_id = EXCLUDED.event_id, synced_at = now()`,
      [taskId, owner, created.id, connection.calendar_id],
    );
    await logCalendar(taskId, owner, "calendar_event_created", { event_id: created.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markError(owner, message);
    if (error instanceof GoogleAuthError) return;
    console.error(`[agenda] falha ao sincronizar a tarefa ${taskId}:`, message);
  }
}

/** Chamada quando a tarefa é excluída: o vínculo já foi embora em cascata. */
export async function removeTaskFromCalendar(links: LinkRow[], taskId: string): Promise<void> {
  for (const link of links) await dropEvent(taskId, link, "tarefa excluída", false);
}

/** Vínculos de uma tarefa — lidos antes de excluí-la, já que a linha cai junto. */
export async function linksOfTask(taskId: string): Promise<LinkRow[]> {
  return query<LinkRow>(
    `SELECT user_id, event_id, calendar_id FROM task_calendar_events WHERE task_id = $1`,
    [taskId],
  );
}

// ─────────────────────────── agenda → app ───────────────────────────────

/** Compromisso apagado na agenda: a tarefa perde as datas, mas continua. */
async function clearTaskDates(taskId: string, userId: string, eventId: string): Promise<void> {
  const cleared = await queryOne<{ id: string }>(
    `UPDATE tasks SET start_date = NULL, due_date = NULL
      WHERE id = $1 AND (start_date IS NOT NULL OR due_date IS NOT NULL)
      RETURNING id`,
    [taskId],
  );
  await query(`DELETE FROM task_calendar_events WHERE task_id = $1 AND user_id = $2`, [
    taskId,
    userId,
  ]);
  if (cleared) {
    await logCalendar(taskId, userId, "calendar_dates_cleared", { event_id: eventId });
  }
}

function taskIdOf(event: CalendarEvent): string | undefined {
  return event.extendedProperties?.private?.[TASK_ID_PROPERTY];
}

export type SyncResult = {
  /** Compromissos apagados na agenda que limparam datas de tarefas. */
  cleared: number;
  /** Eventos lidos nesta rodada. */
  read: number;
};

/**
 * Lê o que mudou na agenda desde a última vez. O `syncToken` faz o Google
 * devolver só a diferença — é o que mantém a sincronização de dez em dez
 * minutos dentro da cota, mesmo com agenda cheia.
 */
export async function pullCalendarChanges(userId: string): Promise<SyncResult> {
  const connection = await getConnection(userId);
  if (!connection) return { cleared: 0, read: 0 };

  const accessToken = await accessTokenFor(connection);
  const janela = () => {
    const now = Date.now();
    return {
      timeMin: new Date(now - 30 * 86_400_000).toISOString(),
      timeMax: new Date(now + 180 * 86_400_000).toISOString(),
    };
  };

  let page;
  try {
    page = await listEvents(accessToken, connection.calendar_id, {
      syncToken: connection.sync_token ?? undefined,
      ...janela(),
    });
  } catch (error) {
    if (error instanceof SyncTokenExpiredError) {
      // Marcador vencido: o Google manda recomeçar sem ele.
      page = await listEvents(accessToken, connection.calendar_id, janela());
    } else {
      const message = error instanceof Error ? error.message : String(error);
      await markError(userId, message);
      throw error;
    }
  }

  let cleared = 0;
  for (const event of page.events) {
    if (event.status !== "cancelled") continue;

    const link = await queryOne<{ task_id: string }>(
      `SELECT task_id FROM task_calendar_events WHERE event_id = $1 AND user_id = $2`,
      [event.id, userId],
    );
    const taskId = link?.task_id ?? taskIdOf(event);
    if (!taskId) continue;

    await clearTaskDates(taskId, userId, event.id);
    cleared += 1;
  }

  await query(
    `UPDATE google_accounts SET sync_token = $2, last_sync_at = now(), last_error = NULL
      WHERE user_id = $1`,
    [userId, page.nextSyncToken ?? connection.sync_token],
  );

  return { cleared, read: page.events.length };
}

/** Compromissos da agenda numa janela, para o calendário do painel. */
export async function listCalendarEvents(
  userId: string,
  range: { from: string; to: string },
): Promise<
  Array<{ id: string; title: string; start: string; end: string; taskId?: string; link?: string }>
> {
  const connection = await getConnection(userId);
  if (!connection) return [];

  const accessToken = await accessTokenFor(connection);
  const page = await listEvents(accessToken, connection.calendar_id, {
    timeMin: new Date(`${range.from}T00:00:00`).toISOString(),
    timeMax: new Date(`${range.to}T23:59:59`).toISOString(),
  });

  return page.events
    .filter((event) => event.status !== "cancelled" && (event.start?.dateTime || event.start?.date))
    .map((event) => ({
      id: event.id,
      title: event.summary ?? "(sem título)",
      start: event.start?.dateTime ?? `${event.start?.date}T00:00:00`,
      end: event.end?.dateTime ?? `${event.end?.date ?? event.start?.date}T23:59:59`,
      ...(taskIdOf(event) ? { taskId: taskIdOf(event)! } : {}),
      ...(event.htmlLink ? { link: event.htmlLink } : {}),
    }));
}

/** Sincronização completa de um usuário: puxa a agenda e devolve o resumo. */
export async function syncUser(userId: string): Promise<SyncResult> {
  return pullCalendarChanges(userId);
}

/** Quem está conectado e já passou do intervalo — usado pelo agendador. */
export async function usersDueForSync(intervalMinutes: number): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT user_id FROM google_accounts
      WHERE last_sync_at IS NULL OR last_sync_at < now() - ($1 || ' minutes')::interval`,
    [String(intervalMinutes)],
  );
  return rows.map((row) => row.user_id);
}
