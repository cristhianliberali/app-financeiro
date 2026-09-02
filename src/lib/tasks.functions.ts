import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

// `pg` só existe no Node e este arquivo vai para o bundle do navegador, então
// o módulo do servidor entra por `await import()` dentro de cada handler.

const POLARITIES = ["IN_PROGRESS", "SUCCESS", "ARCHIVED"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low", "none"] as const;
const BOARD_VIEWS = ["kanban", "list", "calendar"] as const;
const BOARD_STAGES = ["planning", "active", "paused", "done"] as const;

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requireText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = 20_000): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : null;
}

/** Aceita apenas ISO-8601; qualquer outra coisa vira `null`. */
function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Data pura, no formato YYYY-MM-DD. */
function optionalDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Número >= 0 com duas casas; qualquer outra coisa vira `null`. */
function optionalHours(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(Math.min(parsed, 99_999) * 100) / 100;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && !!item))];
}

// ──────────────────────── usuários / espaços ────────────────────────────

export const fetchAccountUsers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listAccountUsers(
      context.user.id,
      data.accountId,
    ),
  );

export const fetchSpaces = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listSpaces(
      context.user.id,
      data.accountId,
    ),
  );

export const fetchSpaceMembers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { spaceId: string }) => ({ spaceId: requireId(input?.spaceId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listSpaceMembers(
      context.user.id,
      data.spaceId,
    ),
  );

export const saveSpace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      accountId: string;
      name: string;
      description?: string | null;
      icon?: string;
      color?: string;
      archived?: boolean;
      memberIds?: string[] | null;
    }) => ({
      ...(input?.id ? { id: input.id } : {}),
      accountId: requireId(input?.accountId, "accountId"),
      name: requireText(input?.name, "Nome do espaço", 120),
      description: optionalText(input?.description, 2000),
      icon: typeof input?.icon === "string" ? input.icon.slice(0, 32) : "folder",
      color: typeof input?.color === "string" ? input.color.slice(0, 32) : "#6366F1",
      archived: input?.archived === true,
      memberIds: input?.memberIds === null ? null : idList(input?.memberIds),
    }),
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveSpace(context.user.id, data),
  );

export const deleteSpace = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteSpace(context.user.id, data.id);
    return null;
  });

// ──────────────────────────────── quadros ───────────────────────────────

export const fetchBoards = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string; spaceId?: string | null }) => ({
    accountId: requireId(input?.accountId, "accountId"),
    ...(optionalId(input?.spaceId) ? { spaceId: input!.spaceId as string } : {}),
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listBoards(
      context.user.id,
      data.accountId,
      data.spaceId,
    ),
  );

export const fetchBoard = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { boardId: string }) => ({ boardId: requireId(input?.boardId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).getBoard(context.user.id, data.boardId),
  );

export const fetchBoardMembers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { boardId: string }) => ({ boardId: requireId(input?.boardId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listBoardMembers(
      context.user.id,
      data.boardId,
    ),
  );

export const createBoard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      spaceId: string;
      name: string;
      description?: string | null;
      ownerId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      defaultView?: string;
      color?: string;
      statuses?: Array<{ name: string; color?: string; polarity?: string }>;
      memberIds?: string[];
    }) => {
      const statuses = (Array.isArray(input?.statuses) ? input.statuses : [])
        .filter((status) => typeof status?.name === "string" && status.name.trim())
        .map((status) => ({
          name: status.name.trim().slice(0, 60),
          color: typeof status.color === "string" ? status.color.slice(0, 32) : "#64748B",
          polarity: oneOf(status.polarity, POLARITIES, "IN_PROGRESS"),
        }));
      if (statuses.length === 0) throw new Error("Configure ao menos um status");

      return {
        spaceId: requireId(input?.spaceId, "spaceId"),
        name: requireText(input?.name, "Nome do quadro", 120),
        description: optionalText(input?.description, 2000),
        ownerId: optionalId(input?.ownerId),
        startDate: optionalDate(input?.startDate),
        dueDate: optionalDate(input?.dueDate),
        defaultView: oneOf(input?.defaultView, BOARD_VIEWS, "kanban"),
        color: typeof input?.color === "string" ? input.color.slice(0, 32) : "#6366F1",
        statuses,
        memberIds: idList(input?.memberIds),
      };
    },
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).createBoard(context.user.id, data),
  );

export const updateBoard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { id: string; patch?: Record<string, unknown>; memberIds?: string[] | null }) => {
      const source = input?.patch ?? {};
      const patch: Record<string, unknown> = {};
      if (source["name"] !== undefined) patch["name"] = requireText(source["name"], "Nome", 120);
      if (source["description"] !== undefined) {
        patch["description"] = optionalText(source["description"], 2000);
      }
      if (source["owner_id"] !== undefined) patch["owner_id"] = optionalId(source["owner_id"]);
      if (source["start_date"] !== undefined) {
        patch["start_date"] = optionalDate(source["start_date"]);
      }
      if (source["due_date"] !== undefined) patch["due_date"] = optionalDate(source["due_date"]);
      if (source["status"] !== undefined) {
        patch["status"] = oneOf(source["status"], BOARD_STAGES, "active");
      }
      if (source["default_view"] !== undefined) {
        patch["default_view"] = oneOf(source["default_view"], BOARD_VIEWS, "kanban");
      }
      if (source["color"] !== undefined) {
        patch["color"] = typeof source["color"] === "string" ? source["color"].slice(0, 32) : null;
      }
      if (source["archived_at"] !== undefined) {
        patch["archived_at"] = optionalTimestamp(source["archived_at"]);
      }
      return {
        id: requireId(input?.id),
        patch,
        ...(input?.memberIds === undefined || input.memberIds === null
          ? {}
          : { memberIds: idList(input.memberIds) }),
      };
    },
  )
  .handler(async ({ data, context }): Promise<null> => {
    await (await import("@/integrations/postgres/tasks.server")).updateBoard(context.user.id, data);
    return null;
  });

export const deleteBoard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteBoard(context.user.id, data.id);
    return null;
  });

// ───────────────────────── status do quadro ─────────────────────────────

export const fetchBoardStatuses = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { boardId: string }) => ({ boardId: requireId(input?.boardId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listBoardStatuses(
      context.user.id,
      data.boardId,
    ),
  );

export const fetchSpaceStatuses = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { spaceId: string }) => ({ spaceId: requireId(input?.spaceId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listSpaceStatuses(
      context.user.id,
      data.spaceId,
    ),
  );

export const saveStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      boardId?: string;
      name: string;
      color?: string;
      polarity?: string;
      sortOrder?: number;
    }) => ({
      ...(input?.id ? { id: input.id } : {}),
      ...(input?.boardId ? { boardId: input.boardId } : {}),
      name: requireText(input?.name, "Nome do status", 60),
      color: typeof input?.color === "string" ? input.color.slice(0, 32) : "#64748B",
      polarity: oneOf(input?.polarity, POLARITIES, "IN_PROGRESS"),
      ...(Number.isInteger(input?.sortOrder) ? { sortOrder: input!.sortOrder as number } : {}),
    }),
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveStatus(context.user.id, data),
  );

export const reorderStatuses = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { items: Array<{ id: string; sortOrder: number }> }) => ({
    items: (Array.isArray(input?.items) ? input.items : []).map((item, index) => ({
      id: requireId(item?.id),
      sortOrder: Number.isInteger(item?.sortOrder) ? item.sortOrder : index,
    })),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).reorderStatuses(context.user.id, data.items);
    return null;
  });

export const deleteStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteStatus(context.user.id, data);
    return null;
  });

// ──────────────────────────────── tarefas ───────────────────────────────

export const fetchTasks = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string; boardId?: string | null }) => ({
    accountId: requireId(input?.accountId, "accountId"),
    ...(optionalId(input?.boardId) ? { boardId: input!.boardId as string } : {}),
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listTasks(context.user.id, data),
  );

export const fetchTaskActivity = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { taskId: string }) => ({ taskId: requireId(input?.taskId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listTaskActivity(
      context.user.id,
      data.taskId,
    ),
  );

export const saveTask = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      boardId: string;
      statusId?: string | null;
      title: string;
      description?: string | null;
      responsibleUserId?: string | null;
      priority?: string;
      estimateHours?: number | null;
      startDate?: string | null;
      dueDate?: string | null;
      sortOrder?: number;
      participantIds?: string[] | null;
      labelIds?: string[] | null;
    }) => ({
      ...(input?.id ? { id: input.id } : {}),
      boardId: requireId(input?.boardId, "boardId"),
      statusId: optionalId(input?.statusId),
      title: requireText(input?.title, "Título da tarefa", 300),
      ...("description" in (input ?? {}) ? { description: optionalText(input.description) } : {}),
      ...("responsibleUserId" in (input ?? {})
        ? { responsibleUserId: optionalId(input.responsibleUserId) }
        : {}),
      ...("priority" in (input ?? {})
        ? { priority: oneOf(input.priority, PRIORITIES, "normal") }
        : {}),
      ...("estimateHours" in (input ?? {})
        ? { estimateHours: optionalHours(input.estimateHours) }
        : {}),
      ...("startDate" in (input ?? {}) ? { startDate: optionalTimestamp(input.startDate) } : {}),
      ...("dueDate" in (input ?? {}) ? { dueDate: optionalTimestamp(input.dueDate) } : {}),
      ...(Number.isInteger(input?.sortOrder) ? { sortOrder: input!.sortOrder as number } : {}),
      ...(input?.participantIds === undefined || input.participantIds === null
        ? {}
        : { participantIds: idList(input.participantIds) }),
      ...(input?.labelIds === undefined || input.labelIds === null
        ? {}
        : { labelIds: idList(input.labelIds) }),
    }),
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveTask(context.user.id, data),
  );

export const moveTask = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string; statusId: string; sortOrder?: number }) => ({
    id: requireId(input?.id),
    statusId: requireId(input?.statusId, "statusId"),
    ...(Number.isInteger(input?.sortOrder) ? { sortOrder: input!.sortOrder as number } : {}),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    await (await import("@/integrations/postgres/tasks.server")).moveTask(context.user.id, data);
    return null;
  });

export const moveTaskByPolarity = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string; polarity: string }) => ({
    id: requireId(input?.id),
    polarity: oneOf(input?.polarity, POLARITIES, "IN_PROGRESS"),
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).moveTaskByPolarity(
      context.user.id,
      data,
    ),
  );

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteTask(context.user.id, data.id);
    return null;
  });

// ─────────────────────────────── etiquetas ──────────────────────────────

export const fetchLabels = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listLabels(
      context.user.id,
      data.accountId,
    ),
  );

export const saveLabel = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string; accountId: string; name: string; color?: string }) => ({
    ...(input?.id ? { id: input.id } : {}),
    accountId: requireId(input?.accountId, "accountId"),
    name: requireText(input?.name, "Nome da etiqueta", 40),
    color: typeof input?.color === "string" ? input.color.slice(0, 32) : "#737373",
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveLabel(context.user.id, data),
  );

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteLabel(context.user.id, data.id);
    return null;
  });

// ─────────────────────────────── lembretes ──────────────────────────────

export const saveReminder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      taskId: string;
      userId?: string | null;
      remindAt: string;
      note?: string | null;
    }) => {
      const remindAt = optionalTimestamp(input?.remindAt);
      if (!remindAt) throw new Error("Informe a data e a hora do lembrete");
      return {
        ...(input?.id ? { id: input.id } : {}),
        taskId: requireId(input?.taskId, "taskId"),
        userId: optionalId(input?.userId),
        remindAt,
        note: optionalText(input?.note, 300),
      };
    },
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveReminder(context.user.id, data),
  );

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteReminder(context.user.id, data.id);
    return null;
  });

export const fetchDueReminders = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    (await import("@/integrations/postgres/tasks.server")).listDueReminders(context.user.id),
  );

export const fetchUpcomingReminders = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    (await import("@/integrations/postgres/tasks.server")).listUpcomingReminders(context.user.id),
  );

export const ackReminders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { ids: string[] }) => ({ ids: idList(input?.ids) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).markRemindersDelivered(context.user.id, data.ids);
    return null;
  });

// ─────────────────────────────── subtarefas ─────────────────────────────

export const saveSubtask = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      id?: string;
      taskId: string;
      title?: string;
      responsibleUserId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      completed?: boolean;
      sortOrder?: number;
    }) => ({
      ...(input?.id ? { id: input.id } : {}),
      taskId: requireId(input?.taskId, "taskId"),
      ...(typeof input?.title === "string"
        ? { title: requireText(input.title, "Título da subtarefa", 300) }
        : {}),
      ...("responsibleUserId" in (input ?? {})
        ? { responsibleUserId: optionalId(input.responsibleUserId) }
        : {}),
      ...("startDate" in (input ?? {}) ? { startDate: optionalTimestamp(input.startDate) } : {}),
      ...("dueDate" in (input ?? {}) ? { dueDate: optionalTimestamp(input.dueDate) } : {}),
      ...(typeof input?.completed === "boolean" ? { completed: input.completed } : {}),
      ...(Number.isInteger(input?.sortOrder) ? { sortOrder: input!.sortOrder as number } : {}),
    }),
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).saveSubtask(context.user.id, data),
  );

export const deleteSubtask = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteSubtask(context.user.id, data.id);
    return null;
  });

// ──────────────────────── rastreamento de tempo ─────────────────────────

export const fetchActiveTimer = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) =>
    (await import("@/integrations/postgres/tasks.server")).getActiveTimer(context.user.id),
  );

export const startTimer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { taskId: string }) => ({ taskId: requireId(input?.taskId, "taskId") }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).startTimer(context.user.id, data.taskId),
  );

export const stopTimer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { entryId?: string | null }) => ({
    entryId: optionalId(input?.entryId),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).stopTimer(context.user.id, data.entryId ?? undefined);
    return null;
  });

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/tasks.server")
    ).deleteTimeEntry(context.user.id, data.id);
    return null;
  });

export const fetchAccountTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string; from?: string; to?: string }) => ({
    accountId: requireId(input?.accountId, "accountId"),
    ...(optionalDate(input?.from) ? { from: input!.from as string } : {}),
    ...(optionalDate(input?.to) ? { to: input!.to as string } : {}),
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/tasks.server")).listAccountTimeEntries(
      context.user.id,
      data,
    ),
  );

// ─────────────────────── modelos de etapas (por conta) ───────────────────────

export const fetchStatusTemplates = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({
    accountId: requireId(input?.accountId, "accountId"),
  }))
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/status-templates.server")).listStatusTemplates(
      context.user.id,
      data.accountId,
    ),
  );

/**
 * Salva o modelo. A lista de etapas é higienizada no servidor — ela vira etapa
 * de quadro depois, e uma polaridade inventada aqui viraria um status que o
 * resto do app não sabe classificar.
 */
export const saveStatusTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { id?: string; accountId: string; name: string; statuses: unknown[] }) => ({
      ...(input?.id ? { id: requireId(input.id) } : {}),
      accountId: requireId(input?.accountId, "accountId"),
      name: requireText(input?.name, "Nome do modelo", 80),
      statuses: Array.isArray(input?.statuses) ? input.statuses : [],
    }),
  )
  .handler(async ({ data, context }) =>
    (await import("@/integrations/postgres/status-templates.server")).saveStatusTemplate(
      context.user.id,
      data,
    ),
  );

export const deleteStatusTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    await (
      await import("@/integrations/postgres/status-templates.server")
    ).deleteStatusTemplate(context.user.id, data.id);
    return null;
  });
