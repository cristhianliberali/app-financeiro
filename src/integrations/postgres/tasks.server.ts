/**
 * Tarefas e Projetos: espaços, quadros, status, tarefas, subtarefas e tempo.
 *
 * Mesma divisão do resto do app — o navegador nunca fala com o banco, e cada
 * operação começa checando o papel do usuário na conta (`requireAccountRole`)
 * e a visibilidade do espaço. Sem RLS: quem autoriza é este arquivo.
 */
import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "./client.server";
import { ForbiddenError, requireAccountRole, type AccountRole } from "./access.server";

// ─────────────────────────────── helpers ────────────────────────────────

/**
 * timestamptz → texto ISO-8601 em UTC.
 *
 * O driver devolveria `Date`, e `::text` daria "2026-08-28 00:00:00+00", que o
 * Safari não aceita em `new Date(...)`. O front trabalha só com ISO.
 */
const iso = (expr: string, alias: string) =>
  `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${alias}`;

/** Igual ao `iso`, mas para uso dentro de `jsonb_build_object`. */
const isoValue = (expr: string) =>
  `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * Espaços que o usuário enxerga: precisa ser membro da conta e, quando o
 * espaço tem lista de acesso, estar nela (ou ter criado o espaço).
 */
const VISIBLE_SPACE = `
  EXISTS (SELECT 1 FROM account_members m
           WHERE m.account_id = s.account_id AND m.user_id = $1)
  AND (
    NOT EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = s.id)
    OR EXISTS (SELECT 1 FROM space_members sm WHERE sm.space_id = s.id AND sm.user_id = $1)
    OR s.created_by = $1
  )`;

async function spaceRow(spaceId: string) {
  return queryOne<{ account_id: string; created_by: string }>(
    `SELECT account_id, created_by FROM spaces WHERE id = $1`,
    [spaceId],
  );
}

/** O espaço está visível para este usuário? (independente do papel na conta) */
async function isSpaceVisible(userId: string, spaceId: string): Promise<boolean> {
  const row = await queryOne<{ visible: boolean }>(
    `SELECT (${VISIBLE_SPACE}) AS visible FROM spaces s WHERE s.id = $2`,
    [userId, spaceId],
  );
  return row?.visible === true;
}

export async function requireSpaceAccess(
  userId: string,
  spaceId: string,
  minimum: AccountRole,
): Promise<{ accountId: string; role: AccountRole }> {
  const space = await spaceRow(spaceId);
  if (!space) throw new ForbiddenError("Espaço não encontrado");
  const role = await requireAccountRole(userId, space.account_id, minimum);
  if (!(await isSpaceVisible(userId, spaceId))) {
    throw new ForbiddenError("Você não tem acesso a este espaço");
  }
  return { accountId: space.account_id, role };
}

export async function requireBoardAccess(userId: string, boardId: string, minimum: AccountRole) {
  const row = await queryOne<{ space_id: string }>(`SELECT space_id FROM boards WHERE id = $1`, [
    boardId,
  ]);
  if (!row) throw new ForbiddenError("Quadro não encontrado");
  const access = await requireSpaceAccess(userId, row.space_id, minimum);
  return { ...access, spaceId: row.space_id };
}

export async function requireTaskAccess(userId: string, taskId: string, minimum: AccountRole) {
  const row = await queryOne<{ board_id: string }>(`SELECT board_id FROM tasks WHERE id = $1`, [
    taskId,
  ]);
  if (!row) throw new ForbiddenError("Tarefa não encontrada");
  const access = await requireBoardAccess(userId, row.board_id, minimum);
  return { ...access, boardId: row.board_id };
}

async function requireStatusBoard(userId: string, statusId: string, minimum: AccountRole) {
  const row = await queryOne<{ board_id: string }>(
    `SELECT board_id FROM board_statuses WHERE id = $1`,
    [statusId],
  );
  if (!row) throw new ForbiddenError("Status não encontrado");
  await requireBoardAccess(userId, row.board_id, minimum);
  return row.board_id;
}

/** Trilha de auditoria da tarefa. Nunca pode derrubar a operação principal. */
async function logActivity(
  client: PoolClient | null,
  taskId: string,
  userId: string,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const sql = `INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)`;
  const params = [taskId, userId, action, JSON.stringify(meta)];
  try {
    if (client) await client.query(sql, params);
    else await query(sql, params);
  } catch (error) {
    console.error("[tarefas] não foi possível registrar a atividade:", error);
  }
}

// ────────────────────────── usuários da conta ───────────────────────────

export async function listAccountUsers(userId: string, accountId: string) {
  await requireAccountRole(userId, accountId, "viewer");
  return query(
    `SELECT m.user_id,
            COALESCE(m.email, u.email) AS email,
            COALESCE(NULLIF(u.full_name, ''), split_part(COALESCE(m.email, u.email), '@', 1)) AS name
       FROM account_members m
       JOIN app_users u ON u.id = m.user_id
      WHERE m.account_id = $1
      ORDER BY 3`,
    [accountId],
  );
}

// ──────────────────────────────── espaços ───────────────────────────────

const SPACE_COLUMNS = `s.id, s.account_id, s.name, s.description, s.icon, s.color, s.created_by,
  ${iso("s.created_at", "created_at")}, ${iso("s.archived_at", "archived_at")}`;

export async function listSpaces(userId: string, accountId: string) {
  await requireAccountRole(userId, accountId, "viewer");
  return query(
    `SELECT ${SPACE_COLUMNS} FROM spaces s
      WHERE s.account_id = $2 AND (${VISIBLE_SPACE})
      ORDER BY s.created_at`,
    [userId, accountId],
  );
}

export async function listSpaceMembers(userId: string, spaceId: string): Promise<string[]> {
  await requireSpaceAccess(userId, spaceId, "viewer");
  const rows = await query<{ user_id: string }>(
    `SELECT user_id FROM space_members WHERE space_id = $1`,
    [spaceId],
  );
  return rows.map((row) => row.user_id);
}

export type SaveSpaceInput = {
  id?: string;
  accountId: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  archived: boolean;
  memberIds: string[] | null;
};

export async function saveSpace(userId: string, input: SaveSpaceInput): Promise<string> {
  if (input.id) await requireSpaceAccess(userId, input.id, "editor");
  else await requireAccountRole(userId, input.accountId, "editor");

  return withTransaction(async (client) => {
    let spaceId = input.id;
    const archivedAt = input.archived ? new Date().toISOString() : null;

    if (spaceId) {
      await client.query(
        `UPDATE spaces SET name = $2, description = $3, icon = $4, color = $5, archived_at = $6
          WHERE id = $1`,
        [spaceId, input.name, input.description, input.icon, input.color, archivedAt],
      );
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO spaces (account_id, name, description, icon, color, archived_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          input.accountId,
          input.name,
          input.description,
          input.icon,
          input.color,
          archivedAt,
          userId,
        ],
      );
      spaceId = created.rows[0]!.id;
    }

    if (input.memberIds) {
      await client.query(`DELETE FROM space_members WHERE space_id = $1`, [spaceId]);
      for (const memberId of input.memberIds) {
        await client.query(
          `INSERT INTO space_members (space_id, user_id) VALUES ($1, $2)
           ON CONFLICT (space_id, user_id) DO NOTHING`,
          [spaceId, memberId],
        );
      }
    }
    return spaceId!;
  });
}

export async function deleteSpace(userId: string, spaceId: string): Promise<void> {
  await requireSpaceAccess(userId, spaceId, "editor");
  await query(`DELETE FROM spaces WHERE id = $1`, [spaceId]);
}

// ──────────────────────────────── quadros ───────────────────────────────

const BOARD_COLUMNS = `b.id, b.space_id, b.name, b.description, b.owner_id, b.start_date,
  b.due_date, b.status, b.default_view, b.color, b.created_by,
  ${iso("b.created_at", "created_at")}, ${iso("b.archived_at", "archived_at")}`;

export async function listBoards(userId: string, accountId: string, spaceId?: string) {
  await requireAccountRole(userId, accountId, "viewer");
  const params: unknown[] = [userId, accountId];
  let sql = `SELECT ${BOARD_COLUMNS} FROM boards b
               JOIN spaces s ON s.id = b.space_id
              WHERE s.account_id = $2 AND (${VISIBLE_SPACE})`;
  if (spaceId) sql += ` AND b.space_id = $${params.push(spaceId)}`;
  sql += ` ORDER BY b.created_at`;
  return query(sql, params);
}

export async function getBoard(userId: string, boardId: string) {
  await requireBoardAccess(userId, boardId, "viewer");
  return queryOne(
    `SELECT ${BOARD_COLUMNS},
            jsonb_build_object('id', s.id, 'name', s.name, 'icon', s.icon, 'color', s.color) AS space
       FROM boards b JOIN spaces s ON s.id = b.space_id
      WHERE b.id = $1`,
    [boardId],
  );
}

export async function listBoardMembers(userId: string, boardId: string): Promise<string[]> {
  await requireBoardAccess(userId, boardId, "viewer");
  const rows = await query<{ user_id: string }>(
    `SELECT user_id FROM board_members WHERE board_id = $1`,
    [boardId],
  );
  return rows.map((row) => row.user_id);
}

export type StatusSeed = { name: string; color: string; polarity: string };

export type CreateBoardInput = {
  spaceId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  startDate: string | null;
  dueDate: string | null;
  defaultView: string;
  color: string;
  statuses: StatusSeed[];
  memberIds: string[];
};

export async function createBoard(userId: string, input: CreateBoardInput): Promise<string> {
  await requireSpaceAccess(userId, input.spaceId, "editor");

  return withTransaction(async (client) => {
    const board = await client.query<{ id: string }>(
      `INSERT INTO boards (space_id, name, description, owner_id, start_date, due_date,
                           default_view, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        input.spaceId,
        input.name,
        input.description,
        input.ownerId ?? userId,
        input.startDate,
        input.dueDate,
        input.defaultView,
        input.color,
        userId,
      ],
    );
    const boardId = board.rows[0]!.id;

    for (const [index, status] of input.statuses.entries()) {
      await client.query(
        `INSERT INTO board_statuses (board_id, name, sort_order, color, polarity, is_default)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [boardId, status.name, index, status.color, status.polarity, index === 0],
      );
    }

    for (const memberId of input.memberIds) {
      await client.query(
        `INSERT INTO board_members (board_id, user_id) VALUES ($1, $2)
         ON CONFLICT (board_id, user_id) DO NOTHING`,
        [boardId, memberId],
      );
    }
    return boardId;
  });
}

const BOARD_PATCH_COLUMNS = [
  "name",
  "description",
  "owner_id",
  "start_date",
  "due_date",
  "status",
  "default_view",
  "color",
  "archived_at",
] as const;

export async function updateBoard(
  userId: string,
  input: { id: string; patch: Record<string, unknown>; memberIds?: string[] },
): Promise<void> {
  await requireBoardAccess(userId, input.id, "editor");

  await withTransaction(async (client) => {
    const columns = BOARD_PATCH_COLUMNS.filter((column) => input.patch[column] !== undefined);
    if (columns.length > 0) {
      const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
      await client.query(`UPDATE boards SET ${assignments.join(", ")} WHERE id = $1`, [
        input.id,
        ...columns.map((column) => input.patch[column]),
      ]);
    }
    if (input.memberIds) {
      await client.query(`DELETE FROM board_members WHERE board_id = $1`, [input.id]);
      for (const memberId of input.memberIds) {
        await client.query(
          `INSERT INTO board_members (board_id, user_id) VALUES ($1, $2)
           ON CONFLICT (board_id, user_id) DO NOTHING`,
          [input.id, memberId],
        );
      }
    }
  });
}

export async function deleteBoard(userId: string, boardId: string): Promise<void> {
  await requireBoardAccess(userId, boardId, "editor");
  await query(`DELETE FROM boards WHERE id = $1`, [boardId]);
}

// ───────────────────────── status do quadro ─────────────────────────────

const STATUS_COLUMNS = "id, board_id, name, sort_order, color, polarity, is_default";

export async function listBoardStatuses(userId: string, boardId: string) {
  await requireBoardAccess(userId, boardId, "viewer");
  return query(
    `SELECT ${STATUS_COLUMNS} FROM board_statuses WHERE board_id = $1 ORDER BY sort_order`,
    [boardId],
  );
}

export async function saveStatus(
  userId: string,
  input: {
    id?: string;
    boardId?: string;
    name: string;
    color: string;
    polarity: string;
    sortOrder?: number;
  },
): Promise<string> {
  if (input.id) {
    await requireStatusBoard(userId, input.id, "editor");
    const params: unknown[] = [input.id, input.name, input.color, input.polarity];
    let sql = `UPDATE board_statuses SET name = $2, color = $3, polarity = $4`;
    if (input.sortOrder !== undefined) sql += `, sort_order = $${params.push(input.sortOrder)}`;
    await query(`${sql} WHERE id = $1`, params);
    return input.id;
  }

  if (!input.boardId) throw new Error("boardId é obrigatório para criar um status");
  await requireBoardAccess(userId, input.boardId, "editor");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO board_statuses (board_id, name, color, polarity, sort_order)
     VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(sort_order) + 1, 0)
                                             FROM board_statuses WHERE board_id = $1)))
     RETURNING id`,
    [input.boardId, input.name, input.color, input.polarity, input.sortOrder ?? null],
  );
  return row!.id;
}

export async function reorderStatuses(
  userId: string,
  ordered: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  if (ordered.length === 0) return;
  await requireStatusBoard(userId, ordered[0]!.id, "editor");
  await withTransaction(async (client) => {
    for (const item of ordered) {
      await client.query(`UPDATE board_statuses SET sort_order = $2 WHERE id = $1`, [
        item.id,
        item.sortOrder,
      ]);
    }
  });
}

/**
 * Exclui um status do quadro.
 *
 * Um status com tarefas não pode ser excluído: mover as tarefas para outra
 * coluna por conta própria esconderia trabalho de quem não pediu isso. Quem
 * quiser remover a etapa move (ou exclui) as tarefas antes. O quadro também
 * precisa continuar com pelo menos um status, senão as tarefas ficariam sem
 * lugar nenhum.
 */
export async function deleteStatus(userId: string, input: { id: string }): Promise<void> {
  const boardId = await requireStatusBoard(userId, input.id, "editor");

  const usage = await queryOne<{ tasks: number; statuses: number }>(
    `SELECT (SELECT count(*) FROM tasks WHERE status_id = $1)::int AS tasks,
            (SELECT count(*) FROM board_statuses WHERE board_id = $2)::int AS statuses`,
    [input.id, boardId],
  );

  if ((usage?.tasks ?? 0) > 0) {
    const total = usage!.tasks;
    throw new Error(
      `Esta etapa tem ${total} ${total === 1 ? "tarefa" : "tarefas"}. ` +
        "Mova ou exclua as tarefas antes de removê-la.",
    );
  }
  if ((usage?.statuses ?? 0) <= 1) {
    throw new Error("O quadro precisa de ao menos uma etapa.");
  }

  await query(`DELETE FROM board_statuses WHERE id = $1`, [input.id]);
}

// ──────────────────────────────── tarefas ───────────────────────────────

/**
 * Uma tarefa já vem com status, quadro, espaço, participantes, subtarefas e
 * registros de tempo agregados — é o formato que as telas consomem, e evita
 * uma cascata de consultas por tarefa.
 */
const TASK_SELECT = `
  t.id, t.board_id, t.status_id, t.title, t.description, t.responsible_user_id, t.sort_order,
  t.created_by, t.priority,
  t.estimate_hours::float8 AS estimate_hours,
  ${iso("t.start_date", "start_date")},
  ${iso("t.due_date", "due_date")},
  ${iso("t.created_at", "created_at")},
  ${iso("t.completed_at", "completed_at")},
  ${iso("t.archived_at", "archived_at")},
  CASE WHEN bs.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', bs.id, 'board_id', bs.board_id, 'name', bs.name, 'sort_order', bs.sort_order,
    'color', bs.color, 'polarity', bs.polarity, 'is_default', bs.is_default) END AS status,
  jsonb_build_object('id', b.id, 'name', b.name, 'color', b.color, 'space_id', b.space_id) AS board,
  jsonb_build_object('id', s.id, 'name', s.name, 'icon', s.icon, 'color', s.color) AS space,
  COALESCE((SELECT jsonb_agg(tp.user_id)
              FROM task_participants tp WHERE tp.task_id = t.id), '[]'::jsonb) AS participants,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', st.id, 'task_id', st.task_id, 'title', st.title,
              'responsible_user_id', st.responsible_user_id,
              'start_date', ${isoValue("st.start_date")},
              'due_date', ${isoValue("st.due_date")},
              'completed', st.completed,
              'completed_at', ${isoValue("st.completed_at")},
              'sort_order', st.sort_order) ORDER BY st.sort_order)
              FROM subtasks st WHERE st.task_id = t.id), '[]'::jsonb) AS subtasks,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', te.id, 'task_id', te.task_id, 'user_id', te.user_id,
              'started_at', ${isoValue("te.started_at")},
              'stopped_at', ${isoValue("te.stopped_at")},
              'duration_seconds', te.duration_seconds) ORDER BY te.started_at DESC)
              FROM time_entries te WHERE te.task_id = t.id), '[]'::jsonb) AS entries,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color)
                             ORDER BY lower(l.name))
              FROM task_label_links tll
              JOIN labels l ON l.id = tll.label_id
             WHERE tll.task_id = t.id), '[]'::jsonb) AS labels,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', tr.id, 'task_id', tr.task_id, 'user_id', tr.user_id,
              'remind_at', ${isoValue("tr.remind_at")},
              'delivered_at', ${isoValue("tr.delivered_at")},
              'note', tr.note) ORDER BY tr.remind_at)
              FROM task_reminders tr WHERE tr.task_id = t.id), '[]'::jsonb) AS reminders`;

const TASK_FROM = `
  FROM tasks t
  JOIN boards b ON b.id = t.board_id
  JOIN spaces s ON s.id = b.space_id
  LEFT JOIN board_statuses bs ON bs.id = t.status_id`;

export async function listTasks(userId: string, opts: { accountId: string; boardId?: string }) {
  await requireAccountRole(userId, opts.accountId, "viewer");
  const params: unknown[] = [userId, opts.accountId];
  let sql = `SELECT ${TASK_SELECT} ${TASK_FROM}
              WHERE s.account_id = $2 AND (${VISIBLE_SPACE})`;
  if (opts.boardId) sql += ` AND t.board_id = $${params.push(opts.boardId)}`;
  sql += ` ORDER BY t.sort_order, t.created_at LIMIT 5000`;
  return query(sql, params);
}

export async function listTaskActivity(userId: string, taskId: string) {
  await requireTaskAccess(userId, taskId, "viewer");
  return query(
    `SELECT id, task_id, user_id, action, meta, ${iso("created_at", "created_at")}
       FROM task_activity WHERE task_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [taskId],
  );
}

export type SaveTaskInput = {
  id?: string;
  boardId: string;
  statusId: string | null;
  title: string;
  description?: string | null;
  responsibleUserId?: string | null;
  priority?: string;
  estimateHours?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  sortOrder?: number;
  participantIds?: string[];
  labelIds?: string[];
};

/** Colunas que o cliente pode gravar, e a chave equivalente na entrada. */
const TASK_FIELDS = [
  ["description", "description"],
  ["responsible_user_id", "responsibleUserId"],
  ["priority", "priority"],
  ["estimate_hours", "estimateHours"],
  ["start_date", "startDate"],
  ["due_date", "dueDate"],
  ["sort_order", "sortOrder"],
] as const;

export async function saveTask(userId: string, input: SaveTaskInput): Promise<string> {
  if (input.id) await requireTaskAccess(userId, input.id, "editor");
  else await requireBoardAccess(userId, input.boardId, "editor");

  // Um status só pode vir do próprio quadro da tarefa.
  if (input.statusId) {
    const status = await queryOne(`SELECT 1 FROM board_statuses WHERE id = $1 AND board_id = $2`, [
      input.statusId,
      input.boardId,
    ]);
    if (!status) throw new ForbiddenError("Status não pertence a este quadro");
  }

  return withTransaction(async (client) => {
    let taskId = input.id;

    if (taskId) {
      const before = await client.query<{
        title: string;
        status_id: string | null;
        responsible_user_id: string | null;
        priority: string;
        start_date: Date | null;
        due_date: Date | null;
      }>(
        `SELECT title, status_id, responsible_user_id, priority, start_date, due_date
           FROM tasks WHERE id = $1`,
        [taskId],
      );
      const previous = before.rows[0]!;

      const columns: string[] = ["title = $2", "status_id = $3"];
      const values: unknown[] = [taskId, input.title, input.statusId];
      for (const [column, key] of TASK_FIELDS) {
        const value = input[key];
        if (value !== undefined) columns.push(`${column} = $${values.push(value)}`);
      }
      await client.query(`UPDATE tasks SET ${columns.join(", ")} WHERE id = $1`, values);

      await recordTaskChanges(client, taskId, userId, previous, input);
    } else {
      // Tarefa sem responsável escolhido fica com quem a criou: toda tarefa
      // nasce com um dono, e é isso que "Minhas tarefas" e os lembretes usam.
      const created = await client.query<{ id: string }>(
        `INSERT INTO tasks (board_id, status_id, title, description, responsible_user_id,
                            priority, estimate_hours, start_date, due_date, sort_order,
                            created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5::uuid, $11::uuid), COALESCE($6::text, 'normal'),
                 $7::numeric, $8::timestamptz, $9::timestamptz, COALESCE($10::int, 0), $11::uuid)
         RETURNING id`,
        [
          input.boardId,
          input.statusId,
          input.title,
          input.description ?? null,
          input.responsibleUserId ?? null,
          input.priority ?? null,
          input.estimateHours ?? null,
          input.startDate ?? null,
          input.dueDate ?? null,
          input.sortOrder ?? null,
          userId,
        ],
      );
      taskId = created.rows[0]!.id;
      await logActivity(client, taskId, userId, "task_created", { title: input.title });
    }

    if (input.participantIds) {
      await syncParticipants(client, taskId!, userId, input.participantIds);
    }
    if (input.labelIds) {
      await syncLabels(client, taskId!, input.labelIds);
    }
    return taskId!;
  });
}

/** Substitui as etiquetas da tarefa pelo conjunto informado. */
async function syncLabels(client: PoolClient, taskId: string, labelIds: string[]): Promise<void> {
  await client.query(
    `DELETE FROM task_label_links WHERE task_id = $1 AND NOT (label_id = ANY($2::uuid[]))`,
    [taskId, labelIds],
  );
  for (const labelId of labelIds) {
    await client.query(
      `INSERT INTO task_label_links (task_id, label_id) VALUES ($1, $2)
       ON CONFLICT (task_id, label_id) DO NOTHING`,
      [taskId, labelId],
    );
  }
}

async function recordTaskChanges(
  client: PoolClient,
  taskId: string,
  userId: string,
  previous: {
    title: string;
    status_id: string | null;
    responsible_user_id: string | null;
    priority: string;
    start_date: Date | null;
    due_date: Date | null;
  },
  input: SaveTaskInput,
): Promise<void> {
  if (previous.status_id !== input.statusId) {
    const names = await client.query<{ id: string; name: string; polarity: string }>(
      `SELECT id, name, polarity FROM board_statuses WHERE id = ANY($1::uuid[])`,
      [[previous.status_id, input.statusId].filter(Boolean)],
    );
    const from = names.rows.find((row) => row.id === previous.status_id);
    const to = names.rows.find((row) => row.id === input.statusId);
    await logActivity(client, taskId, userId, "status_changed", {
      from: from?.name ?? null,
      to: to?.name ?? null,
    });
    if (to?.polarity === "SUCCESS") await logActivity(client, taskId, userId, "task_completed");
    if (to?.polarity === "ARCHIVED") await logActivity(client, taskId, userId, "task_archived");
  }

  if (input.title !== previous.title) {
    await logActivity(client, taskId, userId, "title_changed", {
      from: previous.title,
      to: input.title,
    });
  }
  if (
    input.responsibleUserId !== undefined &&
    input.responsibleUserId !== previous.responsible_user_id
  ) {
    await logActivity(client, taskId, userId, "responsible_changed", {
      user_id: input.responsibleUserId,
    });
  }
  if (input.priority !== undefined && input.priority !== previous.priority) {
    await logActivity(client, taskId, userId, "priority_changed", { to: input.priority });
  }
  if (input.dueDate !== undefined && !sameInstant(previous.due_date, input.dueDate)) {
    await logActivity(client, taskId, userId, "due_date_changed", { to: input.dueDate });
  }
  if (input.startDate !== undefined && !sameInstant(previous.start_date, input.startDate)) {
    await logActivity(client, taskId, userId, "start_date_changed", { to: input.startDate });
  }
}

function sameInstant(current: Date | null, next: string | null): boolean {
  if (!current && !next) return true;
  if (!current || !next) return false;
  return current.getTime() === new Date(next).getTime();
}

async function syncParticipants(
  client: PoolClient,
  taskId: string,
  userId: string,
  participantIds: string[],
): Promise<void> {
  const current = await client.query<{ user_id: string }>(
    `SELECT user_id FROM task_participants WHERE task_id = $1`,
    [taskId],
  );
  const currentIds = current.rows.map((row) => row.user_id);
  const toAdd = participantIds.filter((id) => !currentIds.includes(id));
  const toRemove = currentIds.filter((id) => !participantIds.includes(id));

  if (toRemove.length) {
    await client.query(
      `DELETE FROM task_participants WHERE task_id = $1 AND user_id = ANY($2::uuid[])`,
      [taskId, toRemove],
    );
    for (const id of toRemove) {
      await logActivity(client, taskId, userId, "participant_removed", { user_id: id });
    }
  }
  for (const id of toAdd) {
    await client.query(
      `INSERT INTO task_participants (task_id, user_id) VALUES ($1, $2)
       ON CONFLICT (task_id, user_id) DO NOTHING`,
      [taskId, id],
    );
    await logActivity(client, taskId, userId, "participant_added", { user_id: id });
  }
}

/** Move a tarefa entre colunas do Kanban. */
export async function moveTask(
  userId: string,
  input: { id: string; statusId: string; sortOrder?: number },
): Promise<void> {
  const { boardId } = await requireTaskAccess(userId, input.id, "editor");
  const status = await queryOne<{ name: string }>(
    `SELECT name FROM board_statuses WHERE id = $1 AND board_id = $2`,
    [input.statusId, boardId],
  );
  if (!status) throw new ForbiddenError("Status não pertence a este quadro");

  const previous = await queryOne<{ status_id: string | null }>(
    `SELECT status_id FROM tasks WHERE id = $1`,
    [input.id],
  );
  const params: unknown[] = [input.id, input.statusId];
  let sql = `UPDATE tasks SET status_id = $2`;
  if (input.sortOrder !== undefined) sql += `, sort_order = $${params.push(input.sortOrder)}`;
  await query(`${sql} WHERE id = $1`, params);

  if (previous?.status_id !== input.statusId) {
    const from = previous?.status_id
      ? await queryOne<{ name: string }>(`SELECT name FROM board_statuses WHERE id = $1`, [
          previous.status_id,
        ])
      : null;
    await logActivity(null, input.id, userId, "status_changed", {
      from: from?.name ?? null,
      to: status.name,
    });
  }
}

/**
 * Move a tarefa para o primeiro status de uma polaridade dentro do próprio
 * quadro. É o que o Kanban de "Minhas Tarefas" usa: como as tarefas vêm de
 * quadros diferentes, as colunas ali são polaridades, não status.
 */
export async function moveTaskByPolarity(
  userId: string,
  input: { id: string; polarity: string },
): Promise<{ statusName: string } | null> {
  const { boardId } = await requireTaskAccess(userId, input.id, "editor");
  const target = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM board_statuses
      WHERE board_id = $1 AND polarity = $2 ORDER BY sort_order LIMIT 1`,
    [boardId, input.polarity],
  );
  if (!target) return null;
  await moveTask(userId, { id: input.id, statusId: target.id });
  return { statusName: target.name };
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  await requireTaskAccess(userId, taskId, "editor");
  await query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
}

// ─────────────────────────────── etiquetas ──────────────────────────────

export async function listLabels(userId: string, accountId: string) {
  await requireAccountRole(userId, accountId, "viewer");
  return query(
    `SELECT id, account_id, name, color FROM labels WHERE account_id = $1 ORDER BY lower(name)`,
    [accountId],
  );
}

/**
 * Cria ou renomeia uma etiqueta. Sem `id`, um nome já existente na conta é
 * reaproveitado em vez de duplicar — é o que permite digitar a etiqueta direto
 * na tarefa sem se preocupar se ela já existe.
 */
export async function saveLabel(
  userId: string,
  input: { id?: string; accountId: string; name: string; color: string },
): Promise<string> {
  await requireAccountRole(userId, input.accountId, "editor");

  if (input.id) {
    const existing = await queryOne<{ account_id: string }>(
      `SELECT account_id FROM labels WHERE id = $1`,
      [input.id],
    );
    if (!existing || existing.account_id !== input.accountId) {
      throw new ForbiddenError("Etiqueta não encontrada");
    }
    await query(`UPDATE labels SET name = $2, color = $3 WHERE id = $1`, [
      input.id,
      input.name,
      input.color,
    ]);
    return input.id;
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO labels (account_id, name, color, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [input.accountId, input.name, input.color, userId],
  );
  return row!.id;
}

export async function deleteLabel(userId: string, labelId: string): Promise<void> {
  const row = await queryOne<{ account_id: string }>(
    `SELECT account_id FROM labels WHERE id = $1`,
    [labelId],
  );
  if (!row) throw new ForbiddenError("Etiqueta não encontrada");
  await requireAccountRole(userId, row.account_id, "editor");
  await query(`DELETE FROM labels WHERE id = $1`, [labelId]);
}

// ─────────────────────────────── lembretes ──────────────────────────────

/**
 * Agenda um lembrete. Sem destinatário informado, avisa quem está criando —
 * o caso comum é "me lembre desta tarefa".
 */
export async function saveReminder(
  userId: string,
  input: {
    id?: string;
    taskId: string;
    userId: string | null;
    remindAt: string;
    note: string | null;
  },
): Promise<string> {
  await requireTaskAccess(userId, input.taskId, "editor");
  const target = input.userId ?? userId;

  if (input.id) {
    const existing = await queryOne<{ task_id: string }>(
      `SELECT task_id FROM task_reminders WHERE id = $1`,
      [input.id],
    );
    if (!existing || existing.task_id !== input.taskId) {
      throw new ForbiddenError("Lembrete não encontrado");
    }
    // Reagendar reabre o lembrete: o que já foi entregue volta para a fila.
    await query(
      `UPDATE task_reminders SET user_id = $2, remind_at = $3, note = $4, delivered_at = NULL
        WHERE id = $1`,
      [input.id, target, input.remindAt, input.note],
    );
    return input.id;
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO task_reminders (task_id, user_id, remind_at, note, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.taskId, target, input.remindAt, input.note, userId],
  );
  await logActivity(null, input.taskId, userId, "reminder_created", { remind_at: input.remindAt });
  return row!.id;
}

export async function deleteReminder(userId: string, reminderId: string): Promise<void> {
  const row = await queryOne<{ task_id: string; user_id: string }>(
    `SELECT task_id, user_id FROM task_reminders WHERE id = $1`,
    [reminderId],
  );
  if (!row) throw new ForbiddenError("Lembrete não encontrado");
  // O destinatário sempre pode dispensar o próprio lembrete.
  if (row.user_id !== userId) await requireTaskAccess(userId, row.task_id, "editor");
  else await requireTaskAccess(userId, row.task_id, "viewer");
  await query(`DELETE FROM task_reminders WHERE id = $1`, [reminderId]);
}

const REMINDER_COLUMNS = `r.id, r.task_id, r.user_id, r.note,
  ${iso("r.remind_at", "remind_at")}, ${iso("r.delivered_at", "delivered_at")},
  t.title AS task_title, b.id AS board_id, b.name AS board_name,
  s.id AS space_id, s.name AS space_name`;

const REMINDER_FROM = `
  FROM task_reminders r
  JOIN tasks t ON t.id = r.task_id
  JOIN boards b ON b.id = t.board_id
  JOIN spaces s ON s.id = b.space_id`;

/**
 * Lembretes do usuário logado que já venceram e ainda não foram entregues.
 * É o que o app consulta em segundo plano para disparar a notificação.
 */
export async function listDueReminders(userId: string) {
  return query(
    `SELECT ${REMINDER_COLUMNS} ${REMINDER_FROM}
      WHERE r.user_id = $1 AND r.delivered_at IS NULL AND r.remind_at <= now()
        AND (${VISIBLE_SPACE})
      ORDER BY r.remind_at LIMIT 20`,
    [userId],
  );
}

/** Próximos lembretes ainda no futuro — alimenta o sininho do cabeçalho. */
export async function listUpcomingReminders(userId: string) {
  return query(
    `SELECT ${REMINDER_COLUMNS} ${REMINDER_FROM}
      WHERE r.user_id = $1 AND r.delivered_at IS NULL AND r.remind_at > now()
        AND (${VISIBLE_SPACE})
      ORDER BY r.remind_at LIMIT 20`,
    [userId],
  );
}

/**
 * Marca lembretes como entregues. Só mexe nos do próprio usuário, então um id
 * de outra pessoa simplesmente não casa com o WHERE.
 */
export async function markRemindersDelivered(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await query(
    `UPDATE task_reminders SET delivered_at = now()
      WHERE user_id = $1 AND delivered_at IS NULL AND id = ANY($2::uuid[])`,
    [userId, ids],
  );
}

// ─────────────────────────────── subtarefas ─────────────────────────────

const SUBTASK_FIELDS = [
  ["title", "title"],
  ["responsible_user_id", "responsibleUserId"],
  ["start_date", "startDate"],
  ["due_date", "dueDate"],
  ["completed", "completed"],
  ["sort_order", "sortOrder"],
] as const;

export type SaveSubtaskInput = {
  id?: string;
  taskId: string;
  title?: string;
  responsibleUserId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  completed?: boolean;
  sortOrder?: number;
};

export async function saveSubtask(userId: string, input: SaveSubtaskInput): Promise<string> {
  await requireTaskAccess(userId, input.taskId, "editor");

  if (input.id) {
    const existing = await queryOne<{ task_id: string; completed: boolean; title: string }>(
      `SELECT task_id, completed, title FROM subtasks WHERE id = $1`,
      [input.id],
    );
    if (!existing || existing.task_id !== input.taskId) {
      throw new ForbiddenError("Subtarefa não encontrada");
    }

    const columns: string[] = [];
    const values: unknown[] = [input.id];
    for (const [column, key] of SUBTASK_FIELDS) {
      const value = input[key];
      if (value !== undefined) columns.push(`${column} = $${values.push(value)}`);
    }
    if (columns.length) {
      await query(`UPDATE subtasks SET ${columns.join(", ")} WHERE id = $1`, values);
    }
    if (input.completed !== undefined && input.completed !== existing.completed) {
      await logActivity(
        null,
        input.taskId,
        userId,
        input.completed ? "subtask_completed" : "subtask_reopened",
        { title: input.title ?? existing.title },
      );
    }
    return input.id;
  }

  if (!input.title?.trim()) throw new Error("Informe o título da subtarefa");
  const created = await queryOne<{ id: string }>(
    `INSERT INTO subtasks (task_id, title, responsible_user_id, start_date, due_date,
                           completed, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, false), COALESCE($7, 0), $8) RETURNING id`,
    [
      input.taskId,
      input.title.trim(),
      input.responsibleUserId ?? null,
      input.startDate ?? null,
      input.dueDate ?? null,
      input.completed ?? null,
      input.sortOrder ?? null,
      userId,
    ],
  );
  await logActivity(null, input.taskId, userId, "subtask_created", { title: input.title.trim() });
  return created!.id;
}

export async function deleteSubtask(userId: string, subtaskId: string): Promise<void> {
  const row = await queryOne<{ task_id: string }>(`SELECT task_id FROM subtasks WHERE id = $1`, [
    subtaskId,
  ]);
  if (!row) throw new ForbiddenError("Subtarefa não encontrada");
  await requireTaskAccess(userId, row.task_id, "editor");
  await query(`DELETE FROM subtasks WHERE id = $1`, [subtaskId]);
}

// ──────────────────────── rastreamento de tempo ─────────────────────────

/**
 * Inicia o cronômetro encerrando qualquer contagem ativa do mesmo usuário —
 * o índice único parcial em `time_entries` não permitiria duas em aberto.
 */
export async function startTimer(userId: string, taskId: string): Promise<string> {
  await requireTaskAccess(userId, taskId, "viewer");
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE time_entries SET stopped_at = now() WHERE user_id = $1 AND stopped_at IS NULL`,
      [userId],
    );
    const created = await client.query<{ id: string }>(
      `INSERT INTO time_entries (task_id, user_id, started_at) VALUES ($1, $2, now())
       RETURNING id`,
      [taskId, userId],
    );
    await logActivity(client, taskId, userId, "timer_started");
    return created.rows[0]!.id;
  });
}

export async function stopTimer(userId: string, entryId?: string): Promise<string | null> {
  const params: unknown[] = [userId];
  let sql = `UPDATE time_entries SET stopped_at = now()
              WHERE user_id = $1 AND stopped_at IS NULL`;
  if (entryId) sql += ` AND id = $${params.push(entryId)}`;
  const rows = await query<{ id: string; task_id: string; duration_seconds: number | null }>(
    `${sql} RETURNING id, task_id, duration_seconds`,
    params,
  );
  const stopped = rows[0];
  if (stopped) {
    await logActivity(null, stopped.task_id, userId, "time_logged", {
      duration_seconds: stopped.duration_seconds,
    });
  }
  return stopped?.id ?? null;
}

/** Cronômetro em execução do usuário — alimenta o indicador global. */
export async function getActiveTimer(userId: string) {
  return queryOne(
    `SELECT te.id, te.task_id, te.user_id, te.duration_seconds,
            ${iso("te.started_at", "started_at")},
            ${iso("te.stopped_at", "stopped_at")},
            jsonb_build_object('id', t.id, 'title', t.title, 'board_id', t.board_id) AS task
       FROM time_entries te
       JOIN tasks t ON t.id = te.task_id
      WHERE te.user_id = $1 AND te.stopped_at IS NULL
      ORDER BY te.started_at DESC LIMIT 1`,
    [userId],
  );
}

export async function deleteTimeEntry(userId: string, entryId: string): Promise<void> {
  const row = await queryOne<{ user_id: string; task_id: string }>(
    `SELECT user_id, task_id FROM time_entries WHERE id = $1`,
    [entryId],
  );
  if (!row) throw new ForbiddenError("Registro não encontrado");
  // O dono do registro sempre pode apagar; os demais precisam poder editar a tarefa.
  if (row.user_id !== userId) await requireTaskAccess(userId, row.task_id, "editor");
  else await requireTaskAccess(userId, row.task_id, "viewer");
  await query(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
}

/** Registros de tempo da conta num período — base dos relatórios. */
export async function listAccountTimeEntries(
  userId: string,
  opts: { accountId: string; from?: string; to?: string },
) {
  await requireAccountRole(userId, opts.accountId, "viewer");
  const params: unknown[] = [userId, opts.accountId];
  let sql = `
    SELECT te.id, te.task_id, te.user_id, te.duration_seconds,
           ${iso("te.started_at", "started_at")},
           ${iso("te.stopped_at", "stopped_at")},
           t.title AS task_title,
           b.id AS board_id, b.name AS board_name,
           s.id AS space_id, s.name AS space_name
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN boards b ON b.id = t.board_id
      JOIN spaces s ON s.id = b.space_id
     WHERE s.account_id = $2 AND (${VISIBLE_SPACE})`;
  if (opts.from)
    sql += ` AND te.started_at >= $${params.push(`${opts.from}T00:00:00`)}::timestamptz`;
  if (opts.to) sql += ` AND te.started_at <= $${params.push(`${opts.to}T23:59:59`)}::timestamptz`;
  sql += ` ORDER BY te.started_at DESC LIMIT 5000`;
  return query(sql, params);
}
