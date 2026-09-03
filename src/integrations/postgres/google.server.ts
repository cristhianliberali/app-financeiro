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
 *   agenda → app: mover ou esticar o compromisso atualiza as datas da tarefa, e
 *     apagá-lo limpa essas datas — sem apagar a tarefa. A tarefa é o registro
 *     de trabalho; a agenda é só onde ele aparece no dia.
 *
 * Toda mudança feita por aqui fica na trilha da tarefa (`task_activity`), que é
 * onde se descobre depois por que uma data sumiu.
 */
import { query, queryOne } from "./client.server";
import { getGoogleSettings } from "./config.server";
import { decryptToken, encryptToken } from "../google/crypto.server";
import { refreshAccessToken, type GoogleTokens } from "../google/oauth.server";
import {
  GoogleApiError,
  GoogleAuthError,
  SyncTokenExpiredError,
  TASK_ID_PROPERTY,
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
  type CalendarEvent,
} from "../google/calendar.server";
import { taskDatesFromEvent, windowFromTask } from "../google/event-dates";

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

// ───────────────────────────── conexão ──────────────────────────────────

/** Erro do Postgres de tabela que não existe. */
function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01"
  );
}

let avisouTabela = false;

export async function getConnection(userId: string): Promise<GoogleConnection | null> {
  try {
    return await queryOne<GoogleConnection>(
      `SELECT user_id, google_email, calendar_id, access_token, refresh_token, expires_at,
              sync_token, last_sync_at, last_error
         FROM google_accounts WHERE user_id = $1`,
      [userId],
    );
  } catch (error) {
    // Deploy com o código novo e o `db:migrate` ainda por rodar: o resto do app
    // continua de pé, só sem agenda. Avisa uma vez, não a cada requisição.
    if (!isMissingTable(error)) throw error;
    if (!avisouTabela) {
      avisouTabela = true;
      console.error(
        "[agenda] as tabelas da agenda não existem neste banco — rode `bun run db:migrate`",
      );
    }
    return null;
  }
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
  // Renovar o acesso não desfaz o problema anterior — quem apaga o aviso é uma
  // rodada de sincronização que termine inteira sem erro.
  await query(`UPDATE google_accounts SET access_token = $2, expires_at = $3 WHERE user_id = $1`, [
    connection.user_id,
    encryptToken(renewed.accessToken),
    renewed.expiresAt,
  ]);
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

/**
 * Janela do compromisso a partir das datas da tarefa.
 *
 * A conta em si mora em `event-dates.ts`, junto da conversão inversa: as duas
 * pontas da sincronização precisam concordar sobre o que "uma tarefa só com
 * prazo" vira na agenda, senão cada leitura desfaz a escrita anterior.
 */
function windowOf(task: TaskRow): { start: string; end: string } | null {
  const window = windowFromTask(task);
  return window ? { start: window.start.toISOString(), end: window.end.toISOString() } : null;
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
export type TaskSyncResult =
  | { ok: true }
  /**
   * `fatal` distingue as duas recusas que antes eram uma só: a que vale para a
   * rodada inteira (conta, cota, Google fora do ar) e a que é daquele evento
   * (o Google não aceitou o corpo). Sem a distinção, a segunda parava a fila e
   * deixava todas as tarefas seguintes sem compromisso.
   */
  | { ok: false; fatal: boolean; error: string };

export async function syncTaskToCalendar(taskId: string): Promise<TaskSyncResult> {
  const task = await loadTask(taskId);
  const links = await query<LinkRow>(
    `SELECT user_id, event_id, calendar_id FROM task_calendar_events WHERE task_id = $1`,
    [taskId],
  );

  // Tarefa apagada: some da agenda de quem a tivesse.
  if (!task) {
    for (const link of links) await dropEvent(taskId, link, "tarefa excluída", false);
    return { ok: true };
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

  if (!owner || !window) return { ok: true };

  const connection = await getConnection(owner);
  if (!connection) return { ok: true };

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
        return { ok: true };
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
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Só o erro tipado sabe dizer se a recusa é daquele evento. Qualquer outra
    // coisa conta como global: parar a rodada por precaução é o lado seguro de
    // errar, porque insistir numa recusa global só queima cota.
    const fatal = error instanceof GoogleApiError ? error.fatal : true;
    // O aviso vermelho do perfil mostra esta mensagem. A resposta do Google
    // sozinha não diz qual registro corrigir — daí o título e o id junto.
    const message = `${detail} — tarefa "${task.title}" (${taskId})`;
    await markError(owner, message);
    // A trilha só recebe a recusa do próprio evento: uma queda do Google não é
    // defeito da tarefa, e marcá-la aqui a tiraria da fila sem motivo.
    if (!fatal) await logCalendar(taskId, owner, "calendar_event_failed", { error: detail });
    if (!(error instanceof GoogleAuthError)) {
      console.error(`[agenda] falha ao sincronizar a tarefa ${taskId}:`, message);
    }
    return { ok: false, fatal, error: message };
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

type TaskDatesRow = { start_date: Date | null; due_date: Date | null };

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

/**
 * Compromisso movido ou esticado na agenda: a tarefa segue as datas novas.
 *
 * A gravação é direta no banco, e não pelo `saveTask` do módulo de tarefas, de
 * propósito: `saveTask` dispara a escrita de volta na agenda, e escrever de
 * volta o que a agenda acabou de mandar é uma volta inteira de rede para não
 * mudar nada — além de gastar cota do Google a cada sincronização.
 */
async function applyEventDates(
  taskId: string,
  userId: string,
  event: CalendarEvent,
): Promise<boolean> {
  const task = await queryOne<TaskDatesRow>(
    `SELECT start_date, due_date FROM tasks WHERE id = $1`,
    [taskId],
  );
  if (!task) return false;

  const next = taskDatesFromEvent(task, event);
  // `null` aqui é o caso comum: o evento lido é o espelho do que o app escreveu.
  if (!next) return false;

  await query(`UPDATE tasks SET start_date = $2, due_date = $3 WHERE id = $1`, [
    taskId,
    next.start_date,
    next.due_date,
  ]);
  await query(
    `UPDATE task_calendar_events SET synced_at = now() WHERE task_id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  await logCalendar(taskId, userId, "calendar_dates_updated", {
    event_id: event.id,
    start_date: next.start_date?.toISOString() ?? null,
    due_date: next.due_date?.toISOString() ?? null,
  });
  return true;
}

function taskIdOf(event: CalendarEvent): string | undefined {
  return event.extendedProperties?.private?.[TASK_ID_PROPERTY];
}

export type SyncResult = {
  /** Compromissos apagados na agenda que limparam datas de tarefas. */
  cleared: number;
  /** Compromissos movidos ou esticados na agenda que atualizaram datas de tarefas. */
  updated: number;
  /** Eventos lidos nesta rodada. */
  read: number;
  /** Tarefas que ainda não tinham compromisso e foram para a agenda agora. */
  pushed: number;
  /** Tarefas que o Google recusou — a fila seguiu sem elas. */
  refused: number;
  /** O que o Google respondeu quando alguma coisa não deu certo. */
  error?: string;
};

/**
 * Lê o que mudou na agenda desde a última vez. O `syncToken` faz o Google
 * devolver só a diferença — é o que mantém a sincronização de dez em dez
 * minutos dentro da cota, mesmo com agenda cheia.
 */
export async function pullCalendarChanges(userId: string): Promise<SyncResult> {
  const connection = await getConnection(userId);
  if (!connection) return { cleared: 0, updated: 0, read: 0, pushed: 0, refused: 0 };

  const accessToken = await accessTokenFor(connection);
  const janela = () => {
    const now = Date.now();
    return {
      timeMin: new Date(now - 30 * 86_400_000).toISOString(),
      timeMax: new Date(now + 180 * 86_400_000).toISOString(),
    };
  };

  let page;
  /**
   * Leitura incremental: o Google devolve só o que mudou desde o marcador, e
   * portanto tudo o que vem nela mudou de verdade. A completa devolve a janela
   * inteira, mudada ou não — e é só lá que é preciso separar uma da outra.
   */
  let incremental = !!connection.sync_token;
  try {
    page = await listEvents(accessToken, connection.calendar_id, {
      syncToken: connection.sync_token ?? undefined,
      ...janela(),
    });
  } catch (error) {
    if (error instanceof SyncTokenExpiredError) {
      // Marcador vencido: o Google manda recomeçar sem ele.
      page = await listEvents(accessToken, connection.calendar_id, janela());
      incremental = false;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      await markError(userId, message);
      throw error;
    }
  }

  /*
   * Os vínculos de uma vez só, e não um SELECT por evento: a leitura completa
   * (primeira sincronização, ou marcador vencido) traz a agenda inteira da
   * janela, e uma consulta por compromisso viraria centenas por rodada.
   */
  const linkByEvent = new Map<string, { taskId: string; syncedAt: Date }>();
  for (const link of await query<{ task_id: string; event_id: string; synced_at: Date }>(
    `SELECT task_id, event_id, synced_at FROM task_calendar_events WHERE user_id = $1`,
    [userId],
  )) {
    linkByEvent.set(link.event_id, {
      taskId: link.task_id,
      syncedAt: new Date(link.synced_at),
    });
  }

  /** Tarefas que já têm um compromisso vivo — trava contra adotar uma cópia. */
  const tarefasComVinculo = new Set([...linkByEvent.values()].map((link) => link.taskId));

  let cleared = 0;
  let updated = 0;
  let adotados = 0;
  for (const event of page.events) {
    const link = linkByEvent.get(event.id);

    if (event.status === "cancelled") {
      // Apagado: vale também o evento que carrega a marca da tarefa sem vínculo
      // no banco — é como uma exclusão feita antes de o vínculo existir chega.
      const taskId = link?.taskId ?? taskIdOf(event);
      if (!taskId) continue;
      await clearTaskDates(taskId, userId, event.id);
      cleared += 1;
      continue;
    }

    /*
     * Compromisso nosso que perdeu o vínculo no banco.
     *
     * Isso acontece de verdade: desconectar a conta apaga os vínculos e deixa
     * os compromissos na agenda, então quem desconecta e reconecta fica com
     * eventos órfãos que o app criou e não reconhece mais. Ignorá-los deixaria
     * a sincronização calada para sempre justamente nos compromissos mais
     * antigos — os que a pessoa mais mexe.
     *
     * A marca `auraTaskId` só é escrita por nós, então ela basta para readotar.
     * A trava é uma só: se a tarefa já tem outro compromisso vivo, esta é uma
     * cópia que alguém duplicou, e duas cópias brigando pela mesma tarefa é
     * pior do que uma ignorada.
     */
    if (!link) {
      const marcada = taskIdOf(event);
      if (!marcada || tarefasComVinculo.has(marcada)) continue;

      await query(
        `INSERT INTO task_calendar_events (task_id, user_id, event_id, calendar_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, user_id)
         DO UPDATE SET event_id = EXCLUDED.event_id, synced_at = now()`,
        [marcada, userId, event.id, connection.calendar_id],
      );
      tarefasComVinculo.add(marcada);
      adotados += 1;
      if (await applyEventDates(marcada, userId, event)) updated += 1;
      continue;
    }

    /*
     * Na leitura completa, e só nela, também é preciso descartar o que é velho:
     * a janela inteira volta, inclusive o evento que ficou para trás porque o
     * Google recusou a nossa última atualização, e ele desfaria a data mais
     * nova que está na tarefa.
     *
     * Na incremental esta comparação seria um tiro no pé. `synced_at` vem do
     * relógio do Postgres e `updated` vem do relógio do Google: com o servidor
     * alguns minutos adiantado, toda edição feita logo depois de uma escrita
     * nossa seria engolida em silêncio. Ali o Google já garantiu que o evento
     * mudou, e o eco da nossa própria escrita quem barra é a comparação de
     * datas dentro de `applyEventDates`.
     */
    if (!incremental) {
      const modificadoNoGoogle = event.updated ? new Date(event.updated) : null;
      if (modificadoNoGoogle && modificadoNoGoogle <= link.syncedAt) continue;
    }

    if (await applyEventDates(link.taskId, userId, event)) updated += 1;
  }

  /*
   * Uma linha por rodada, com o que a leitura de fato viu. É pouco barulho (uma
   * a cada dez minutos por pessoa) e é o que responde, quando alguém diz que a
   * agenda não está chegando, se a rodada rodou, quantos compromissos ela
   * conferiu e quantos deles o app reconhece como espelho de uma tarefa.
   */
  console.info(
    `[agenda] usuário ${userId}: leitura ${incremental ? "incremental" : "completa"} — ` +
      `${page.events.length} evento(s) lido(s), ${linkByEvent.size} vinculado(s) a tarefas, ` +
      `${adotados} readotado(s), ${updated} data(s) atualizada(s), ${cleared} limpa(s)`,
  );

  // O erro registrado pela escrita não é apagado aqui: ler a agenda com
  // sucesso não desfaz um evento que o Google recusou a criar. Quem limpa é a
  // rodada inteira, quando nada falhou.
  await query(
    `UPDATE google_accounts SET sync_token = $2, last_sync_at = now() WHERE user_id = $1`,
    [userId, page.nextSyncToken ?? connection.sync_token],
  );

  return { cleared, updated, read: page.events.length, pushed: 0, refused: 0 };
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
  /*
   * Ler primeiro, escrever depois — a ordem importa.
   *
   * Ao contrário, `pushPendingTasks` via a tarefa cujo vínculo se perdeu como
   * "ainda não enviada", criava um compromisso novo para ela e gravava o
   * vínculo; quando a leitura chegava, a tarefa já tinha vínculo e o
   * compromisso antigo — o que a pessoa tinha acabado de mover — era descartado
   * como cópia. A edição sumia e ainda sobrava um evento duplicado na agenda.
   *
   * Lendo antes, a leitura readota o compromisso de verdade e o envio já o
   * encontra vinculado, sem duplicar nada.
   */
  const result = await pullCalendarChanges(userId);
  const push = await pushPendingTasks(userId);
  if (!push.error)
    await query(`UPDATE google_accounts SET last_error = NULL WHERE user_id = $1`, [userId]);
  return {
    ...result,
    pushed: push.pushed,
    refused: push.refused,
    ...(push.error ? { error: push.error } : {}),
  };
}

/**
 * Quem entra na fila de envio, em SQL, com o usuário em `$1`.
 *
 * Fica numa constante porque o diagnóstico conta exatamente a mesma fila: se as
 * duas condições divergirem, o relatório passa a mentir justamente quando
 * alguém for conferir por que uma tarefa não subiu.
 */
const FILA_DE_ENVIO = `
    FROM tasks t
    JOIN board_statuses s ON s.id = t.status_id
   WHERE t.responsible_user_id = $1
     AND (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)
     AND coalesce(s.polarity, '') <> 'SUCCESS'
     AND COALESCE(t.due_date, t.start_date) BETWEEN now() - interval '7 days'
                                                AND now() + interval '180 days'
     AND NOT EXISTS (
       SELECT 1 FROM task_calendar_events e
        WHERE e.task_id = t.id AND e.user_id = $1
     )
     -- A tarefa que o Google recusou sai da fila até ser editada — que é como a
     -- recusa costuma ser corrigida — ou até o dia seguinte, para o caso de ter
     -- sido engano passageiro. Sem isso ela consome uma chamada por rodada,
     -- para sempre, e some no meio dos erros de cota.
     AND NOT EXISTS (
       SELECT 1 FROM task_activity a
        WHERE a.task_id = t.id
          AND a.user_id = $1
          AND a.action = 'calendar_event_failed'
          AND a.created_at > GREATEST(t.updated_at, now() - interval '1 day')
     )`;

/**
 * Sobe para a agenda as tarefas que ainda não têm compromisso.
 *
 * É o que faz a agenda começar cheia em vez de vazia: quem conecta a conta já
 * tem tarefas com prazo marcadas há semanas, e elas nunca passaram pelo
 * `saveTask` depois da conexão. Roda ao conectar, no botão "sincronizar agora"
 * e em toda rodada automática — daí também cobrir a tarefa cujo compromisso
 * falhou por uma indisponibilidade passageira do Google.
 *
 * Olha só para a frente (e uns dias para trás): encher a agenda de quem
 * conectou com o arquivo morto de tarefas antigas não ajudaria ninguém.
 */
export async function pushPendingTasks(
  userId: string,
): Promise<{ pushed: number; refused: number; error?: string }> {
  const { maxEventsPerSync } = getGoogleSettings();

  let pending: Array<{ id: string }>;
  try {
    pending = await query<{ id: string }>(
      `SELECT t.id ${FILA_DE_ENVIO}
        ORDER BY COALESCE(t.due_date, t.start_date)
        LIMIT $2`,
      [userId, maxEventsPerSync],
    );
  } catch (error) {
    if (isMissingTable(error)) return { pushed: 0, refused: 0 };
    throw error;
  }

  let pushed = 0;
  let refused = 0;
  let ultimaRecusa = "";
  for (const task of pending) {
    const result = await syncTaskToCalendar(task.id);
    if (result.ok) {
      pushed += 1;
      continue;
    }

    // Recusa global — conta, cota, Google fora do ar: as próximas falhariam
    // igual, então a rodada para aqui e devolve o motivo a quem a pediu.
    if (result.fatal) return { pushed, refused, error: result.error };

    // Recusa daquela tarefa. Ela já ficou registrada na trilha e no aviso do
    // perfil; a fila segue, senão um registro ruim deixaria todos os outros
    // sem compromisso — que foi exatamente o que aconteceu em produção.
    refused += 1;
    ultimaRecusa = result.error;
  }

  return {
    pushed,
    refused,
    // O erro devolvido é o que impede `syncUser` de apagar o aviso do perfil:
    // a rodada não terminou limpa, e a pessoa precisa ver qual tarefa corrigir.
    ...(refused > 0
      ? { error: `${refused} tarefa(s) recusada(s) pelo Google. Última: ${ultimaRecusa}` }
      : {}),
  };
}

/**
 * Retrato do que o Google devolve para esta pessoa, agora.
 *
 * Existe porque "não está sincronizando" tem meia dúzia de causas que, de fora,
 * são idênticas: a conta não está conectada, o compromisso não é espelho de
 * tarefa nenhuma, ele é espelho mas perdeu o vínculo, ou é espelho e está igual
 * à tarefa. Sem ver o que voltou do Google, a diferença entre elas é palpite.
 *
 * A leitura é sempre completa, ignorando o marcador de sincronização: o
 * diagnóstico precisa enxergar a agenda como ela está, não só o que mudou desde
 * a última rodada. Nada aqui grava — é só leitura.
 */
export type CalendarDiagnostic = {
  conectado: boolean;
  email: string | null;
  calendarId: string | null;
  /** Já existe marcador incremental? Sem ele, toda rodada relê a janela. */
  temMarcador: boolean;
  ultimaSync: string | null;
  /**
   * Há quantos minutos foi a última leitura. É o que separa "o agendador não
   * rodou" de "rodou e não achou nada para gravar" — as duas se parecem de
   * fora, e só esta contagem distingue uma da outra.
   */
  minutosDesdeSync: number | null;
  ultimoErro: string | null;
  /** Vínculos evento↔tarefa no banco para esta pessoa. */
  vinculos: number;
  /** Tarefas esperando para virar compromisso agora. */
  pendentesDeEnvio: number;
  /** As últimas tarefas que o Google recusou, com o motivo. */
  recusadas: Array<{ titulo: string; quando: string; motivo: string }>;
  eventosLidos: number;
  /** Dos lidos, quantos carregam a marca que só o app escreve. */
  comMarcaDeTarefa: number;
  /** Dos com marca, quantos o banco reconhece pelo id do evento. */
  comVinculo: number;
  amostra: Array<{
    titulo: string;
    googleInicio: string | null;
    googleFim: string | null;
    googleAlterado: string | null;
    tarefaInicio: string | null;
    tarefaPrazo: string | null;
    veredito: string;
  }>;
  erro?: string;
};

export async function diagnoseCalendar(userId: string): Promise<CalendarDiagnostic> {
  const vazio: CalendarDiagnostic = {
    conectado: false,
    email: null,
    calendarId: null,
    temMarcador: false,
    ultimaSync: null,
    minutosDesdeSync: null,
    ultimoErro: null,
    vinculos: 0,
    pendentesDeEnvio: 0,
    recusadas: [],
    eventosLidos: 0,
    comMarcaDeTarefa: 0,
    comVinculo: 0,
    amostra: [],
  };

  const connection = await getConnection(userId);
  if (!connection) return vazio;

  const ultimaSync = connection.last_sync_at ? new Date(connection.last_sync_at) : null;

  const base: CalendarDiagnostic = {
    ...vazio,
    conectado: true,
    email: connection.google_email,
    calendarId: connection.calendar_id,
    temMarcador: !!connection.sync_token,
    ultimaSync: ultimaSync ? ultimaSync.toISOString() : null,
    minutosDesdeSync: ultimaSync ? Math.round((Date.now() - ultimaSync.getTime()) / 60_000) : null,
    ultimoErro: connection.last_error,
  };

  // O lado do envio, que o relatório não enxergava: quantas tarefas esperam
  // para subir e quais o Google recusou. Sem isso, "a agenda não recebe nada"
  // ficava indistinguível de "não há nada para mandar".
  const [fila] = await query<{ total: string }>(`SELECT count(*)::text AS total ${FILA_DE_ENVIO}`, [
    userId,
  ]);
  base.pendentesDeEnvio = Number(fila?.total ?? 0);

  base.recusadas = (
    await query<{ titulo: string; quando: Date; motivo: string | null }>(
      `SELECT t.title AS titulo, a.created_at AS quando, a.meta->>'error' AS motivo
         FROM task_activity a
         JOIN tasks t ON t.id = a.task_id
        WHERE a.user_id = $1 AND a.action = 'calendar_event_failed'
        ORDER BY a.created_at DESC
        LIMIT 5`,
      [userId],
    )
  ).map((linha) => ({
    titulo: linha.titulo,
    quando: new Date(linha.quando).toISOString(),
    motivo: linha.motivo ?? "(motivo não registrado)",
  }));

  const links = await query<{ task_id: string; event_id: string }>(
    `SELECT task_id, event_id FROM task_calendar_events WHERE user_id = $1`,
    [userId],
  );
  const porEvento = new Map(links.map((link) => [link.event_id, link.task_id]));
  base.vinculos = links.length;

  const now = Date.now();
  let page;
  try {
    page = await listEvents(await accessTokenFor(connection), connection.calendar_id, {
      timeMin: new Date(now - 60 * 86_400_000).toISOString(),
      timeMax: new Date(now + 180 * 86_400_000).toISOString(),
    });
  } catch (error) {
    return { ...base, erro: error instanceof Error ? error.message : String(error) };
  }

  base.eventosLidos = page.events.length;

  for (const event of page.events) {
    if (event.status === "cancelled") continue;
    const marcada = taskIdOf(event);
    if (!marcada) continue;
    base.comMarcaDeTarefa += 1;

    const vinculada = porEvento.get(event.id);
    if (vinculada) base.comVinculo += 1;

    if (base.amostra.length >= 8) continue;

    const task = await queryOne<TaskDatesRow>(
      `SELECT start_date, due_date FROM tasks WHERE id = $1`,
      [vinculada ?? marcada],
    );
    const proximas = task ? taskDatesFromEvent(task, event) : null;

    base.amostra.push({
      titulo: event.summary ?? "(sem título)",
      googleInicio: event.start?.dateTime ?? event.start?.date ?? null,
      googleFim: event.end?.dateTime ?? event.end?.date ?? null,
      googleAlterado: event.updated ?? null,
      tarefaInicio: task?.start_date ? new Date(task.start_date).toISOString() : null,
      tarefaPrazo: task?.due_date ? new Date(task.due_date).toISOString() : null,
      veredito: !task
        ? "a tarefa não existe mais no banco"
        : !vinculada
          ? "compromisso nosso sem vínculo no banco — a leitura vai readotá-lo"
          : proximas
            ? `gravaria início=${proximas.start_date?.toISOString() ?? "—"} ` +
              `prazo=${proximas.due_date?.toISOString() ?? "—"}`
            : "já está igual à tarefa; nada a gravar",
    });
  }

  return base;
}

/** Quem está conectado e já passou do intervalo — usado pelo agendador. */
export async function usersDueForSync(intervalMinutes: number): Promise<string[]> {
  try {
    const rows = await query<{ user_id: string }>(
      `SELECT user_id FROM google_accounts
        WHERE last_sync_at IS NULL OR last_sync_at < now() - ($1 || ' minutes')::interval`,
      [String(intervalMinutes)],
    );
    return rows.map((row) => row.user_id);
  } catch (error) {
    // Banco ainda sem as tabelas: nada a sincronizar, e o aviso já saiu uma vez.
    if (isMissingTable(error)) return [];
    throw error;
  }
}
