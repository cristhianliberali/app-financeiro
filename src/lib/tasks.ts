import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ackReminders,
  createBoard,
  deleteBoard,
  deleteLabel,
  deleteReminder,
  deleteSpace,
  deleteStatus,
  deleteSubtask,
  deleteTask,
  deleteTimeEntry,
  fetchAccountTimeEntries,
  fetchAccountUsers,
  fetchActiveTimer,
  fetchBoard,
  fetchBoardMembers,
  fetchBoardStatuses,
  fetchBoards,
  fetchDueReminders,
  fetchLabels,
  fetchSpaceMembers,
  fetchSpaces,
  fetchTaskActivity,
  fetchTasks,
  fetchUpcomingReminders,
  moveTask,
  moveTaskByPolarity,
  reorderStatuses,
  saveLabel,
  saveReminder,
  saveSpace,
  saveStatus,
  saveSubtask,
  saveTask,
  startTimer,
  stopTimer,
  updateBoard,
} from "./tasks.functions";
import type { BoardStage, BoardView, Polarity, Priority, StatusSeed } from "./tasks-analytics";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Space = {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
};

export type Board = {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: BoardStage;
  default_view: BoardView;
  color: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
};

export type BoardStatus = {
  id: string;
  board_id: string;
  name: string;
  sort_order: number;
  color: string;
  polarity: Polarity;
  is_default: boolean;
};

export type Subtask = {
  id: string;
  task_id: string;
  title: string;
  responsible_user_id: string | null;
  start_date: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  sort_order: number;
};

export type Label = {
  id: string;
  account_id: string;
  name: string;
  color: string;
};

/** Etiqueta como vem embutida na tarefa — só o necessário para exibir o chip. */
export type TaskLabel = Pick<Label, "id" | "name" | "color">;

export type Reminder = {
  id: string;
  task_id: string;
  user_id: string;
  remind_at: string;
  delivered_at: string | null;
  note: string | null;
};

/** Lembrete com o caminho da tarefa — usado no sininho e na notificação. */
export type ReminderFeedItem = Reminder & {
  task_title: string;
  board_id: string;
  board_name: string;
  space_id: string;
  space_name: string;
};

export type TimeEntry = {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
};

export type TaskActivity = {
  id: string;
  task_id: string;
  user_id: string | null;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type Task = {
  id: string;
  board_id: string;
  status_id: string | null;
  title: string;
  description: string | null;
  responsible_user_id: string | null;
  priority: Priority;
  /** Estimativa de esforço em horas; `null` quando não foi informada. */
  estimate_hours: number | null;
  start_date: string | null;
  due_date: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
  status: BoardStatus | null;
  board: { id: string; name: string; color: string; space_id: string };
  space: { id: string; name: string; icon: string; color: string };
  participants: string[];
  subtasks: Subtask[];
  entries: TimeEntry[];
  labels: TaskLabel[];
  reminders: Reminder[];
  /** Soma dos registros já encerrados, em segundos. */
  trackedSeconds: number;
  /** Registro em execução, quando houver. */
  running: TimeEntry | null;
};

export type AccountUser = { user_id: string; email: string | null; name: string };

export type ActiveTimer = TimeEntry & { task: { id: string; title: string; board_id: string } };

export type AccountTimeEntry = {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  task_title: string;
  board_id: string;
  board_name: string;
  space_id: string;
  space_name: string;
};

/** Prefixo único das queries do módulo — toda escrita invalida por ele. */
const KEY = "tp";

/** O servidor devolve a tarefa já agregada; aqui só derivamos o tempo. */
function normalizeTask(row: unknown): Task {
  const task = row as Task;
  const entries = task.entries ?? [];
  return {
    ...task,
    participants: task.participants ?? [],
    subtasks: task.subtasks ?? [],
    labels: task.labels ?? [],
    reminders: task.reminders ?? [],
    entries,
    trackedSeconds: entries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0),
    running: entries.find((entry) => !entry.stopped_at) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Usuários da conta
// ---------------------------------------------------------------------------

export function useAccountUsers(accountId: string | null) {
  return useQuery({
    queryKey: [KEY, "users", accountId],
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccountUser[]> =>
      (await fetchAccountUsers({ data: { accountId: accountId! } })) as AccountUser[],
  });
}

// ---------------------------------------------------------------------------
// Espaços
// ---------------------------------------------------------------------------

export function useSpaces(accountId: string | null) {
  return useQuery({
    queryKey: [KEY, "spaces", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<Space[]> =>
      (await fetchSpaces({ data: { accountId: accountId! } })) as Space[],
  });
}

export function useSpaceMembers(spaceId: string | null) {
  return useQuery({
    queryKey: [KEY, "space-members", spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<string[]> =>
      (await fetchSpaceMembers({ data: { spaceId: spaceId! } })) as string[],
  });
}

export function useSaveSpace(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      description: string | null;
      icon: string;
      color: string;
      archived: boolean;
      memberIds: string[] | null;
    }) =>
      saveSpace({
        data: {
          ...(input.id ? { id: input.id } : {}),
          accountId: accountId!,
          name: input.name,
          description: input.description,
          icon: input.icon,
          color: input.color,
          archived: input.archived,
          memberIds: input.memberIds,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteSpace({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Quadros
// ---------------------------------------------------------------------------

/** Quadros de um espaço; sem espaço informado, todos os quadros visíveis. */
export function useBoards(opts: { accountId: string | null; spaceId?: string | null }) {
  const { accountId, spaceId = null } = opts;
  return useQuery({
    queryKey: [KEY, "boards", accountId, spaceId],
    enabled: !!accountId,
    queryFn: async (): Promise<Board[]> =>
      (await fetchBoards({
        data: { accountId: accountId!, ...(spaceId ? { spaceId } : {}) },
      })) as Board[],
  });
}

export function useBoard(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "board", boardId],
    enabled: !!boardId,
    queryFn: async () =>
      (await fetchBoard({ data: { boardId: boardId! } })) as
        (Board & { space: { id: string; name: string; icon: string; color: string } }) | null,
  });
}

export function useBoardMembers(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "board-members", boardId],
    enabled: !!boardId,
    queryFn: async (): Promise<string[]> =>
      (await fetchBoardMembers({ data: { boardId: boardId! } })) as string[],
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spaceId: string;
      name: string;
      description: string | null;
      ownerId: string | null;
      startDate: string | null;
      dueDate: string | null;
      defaultView: BoardView;
      color: string;
      statuses: StatusSeed[];
      memberIds: string[];
    }) => (await createBoard({ data: input })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          Board,
          | "name"
          | "description"
          | "owner_id"
          | "start_date"
          | "due_date"
          | "status"
          | "default_view"
          | "color"
          | "archived_at"
        >
      >;
      memberIds?: string[];
    }) => {
      await updateBoard({
        data: {
          id: input.id,
          patch: input.patch,
          ...(input.memberIds ? { memberIds: input.memberIds } : {}),
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteBoard({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Status do quadro
// ---------------------------------------------------------------------------

export function useBoardStatuses(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "statuses", boardId],
    enabled: !!boardId,
    queryFn: async (): Promise<BoardStatus[]> =>
      (await fetchBoardStatuses({ data: { boardId: boardId! } })) as BoardStatus[],
  });
}

export function useSaveStatus(boardId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      color: string;
      polarity: Polarity;
      sort_order?: number;
    }) =>
      (await saveStatus({
        data: {
          ...(input.id ? { id: input.id } : { boardId: boardId! }),
          name: input.name,
          color: input.color,
          polarity: input.polarity,
          ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
        },
      })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useReorderStatuses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ordered: Array<{ id: string; sort_order: number }>) => {
      await reorderStatuses({
        data: { items: ordered.map((row) => ({ id: row.id, sortOrder: row.sort_order })) },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; moveToStatusId: string | null }) => {
      await deleteStatus({ data: input });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

/** Tarefas de um quadro, ou de toda a conta quando `boardId` não é informado. */
export function useTasks(opts: { accountId: string | null; boardId?: string | null }) {
  const { accountId, boardId = null } = opts;
  return useQuery({
    queryKey: [KEY, "tasks", accountId, boardId],
    enabled: !!accountId,
    queryFn: async (): Promise<Task[]> => {
      const rows = await fetchTasks({
        data: { accountId: accountId!, ...(boardId ? { boardId } : {}) },
      });
      return (rows as unknown[]).map(normalizeTask);
    },
  });
}

export function useTaskActivity(taskId: string | null) {
  return useQuery({
    queryKey: [KEY, "activity", taskId],
    enabled: !!taskId,
    queryFn: async (): Promise<TaskActivity[]> =>
      (await fetchTaskActivity({ data: { taskId: taskId! } })) as TaskActivity[],
  });
}

export function useSaveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      board_id: string;
      status_id: string | null;
      title: string;
      description?: string | null;
      responsible_user_id?: string | null;
      priority?: Priority;
      estimate_hours?: number | null;
      start_date?: string | null;
      due_date?: string | null;
      sort_order?: number;
      participantIds?: string[];
      labelIds?: string[];
    }) =>
      (await saveTask({
        data: {
          ...(input.id ? { id: input.id } : {}),
          boardId: input.board_id,
          statusId: input.status_id,
          title: input.title,
          ...("description" in input ? { description: input.description } : {}),
          ...("responsible_user_id" in input
            ? { responsibleUserId: input.responsible_user_id }
            : {}),
          ...("priority" in input ? { priority: input.priority } : {}),
          ...("estimate_hours" in input ? { estimateHours: input.estimate_hours } : {}),
          ...("start_date" in input ? { startDate: input.start_date } : {}),
          ...("due_date" in input ? { dueDate: input.due_date } : {}),
          ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
          ...(input.participantIds ? { participantIds: input.participantIds } : {}),
          ...(input.labelIds ? { labelIds: input.labelIds } : {}),
        },
      })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Move a tarefa para outro status (Kanban / drag and drop). */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status_id: string; sort_order?: number }) => {
      await moveTask({
        data: {
          id: input.id,
          statusId: input.status_id,
          ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/**
 * Move a tarefa para a polaridade escolhida; o status equivalente é resolvido
 * no servidor, dentro do quadro da própria tarefa.
 */
export function useMoveTaskByPolarity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; polarity: Polarity }) =>
      (await moveTaskByPolarity({ data: input })) as { statusName: string } | null,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteTask({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export function useLabels(accountId: string | null) {
  return useQuery({
    queryKey: [KEY, "labels", accountId],
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Label[]> =>
      (await fetchLabels({ data: { accountId: accountId! } })) as Label[],
  });
}

export function useSaveLabel(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name: string; color: string }) =>
      (await saveLabel({
        data: {
          ...(input.id ? { id: input.id } : {}),
          accountId: accountId!,
          name: input.name,
          color: input.color,
        },
      })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteLabel({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------------------

export function useSaveReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      task_id: string;
      user_id: string | null;
      remind_at: string;
      note: string | null;
    }) =>
      (await saveReminder({
        data: {
          ...(input.id ? { id: input.id } : {}),
          taskId: input.task_id,
          userId: input.user_id,
          remindAt: input.remind_at,
          note: input.note,
        },
      })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteReminder({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/**
 * Lembretes vencidos e ainda não entregues. É a fila que o app consulta em
 * segundo plano para disparar a notificação — por isso o refetch curto.
 */
export function useDueReminders(enabled: boolean) {
  return useQuery({
    queryKey: [KEY, "reminders", "due"],
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReminderFeedItem[]> =>
      (await fetchDueReminders()) as ReminderFeedItem[],
  });
}

/** Próximos lembretes agendados — o que o sininho lista. */
export function useUpcomingReminders(enabled: boolean) {
  return useQuery({
    queryKey: [KEY, "reminders", "upcoming"],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ReminderFeedItem[]> =>
      (await fetchUpcomingReminders()) as ReminderFeedItem[],
  });
}

/** Marca lembretes como entregues, para não notificarem de novo. */
export function useAckReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await ackReminders({ data: { ids } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "reminders"] }),
  });
}

// ---------------------------------------------------------------------------
// Subtarefas
// ---------------------------------------------------------------------------

export function useSaveSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      task_id: string;
      title?: string;
      responsible_user_id?: string | null;
      start_date?: string | null;
      due_date?: string | null;
      completed?: boolean;
      sort_order?: number;
    }) =>
      (await saveSubtask({
        data: {
          ...(input.id ? { id: input.id } : {}),
          taskId: input.task_id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...("responsible_user_id" in input
            ? { responsibleUserId: input.responsible_user_id }
            : {}),
          ...("start_date" in input ? { startDate: input.start_date } : {}),
          ...("due_date" in input ? { dueDate: input.due_date } : {}),
          ...(input.completed !== undefined ? { completed: input.completed } : {}),
          ...(input.sort_order !== undefined ? { sortOrder: input.sort_order } : {}),
        },
      })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteSubtask({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Rastreamento de tempo
// ---------------------------------------------------------------------------

/** Cronômetro em execução do usuário logado — usado no cabeçalho global. */
export function useActiveTimer() {
  return useQuery({
    queryKey: [KEY, "active-timer"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ActiveTimer | null> =>
      ((await fetchActiveTimer()) as ActiveTimer | null) ?? null,
  });
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => (await startTimer({ data: { taskId } })) as string,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId?: string) => {
      await stopTimer({ data: { entryId: entryId ?? null } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteTimeEntry({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Registros de tempo da conta em um período — base dos relatórios. */
export function useAccountTimeEntries(opts: {
  accountId: string | null;
  from?: string;
  to?: string;
}) {
  const { accountId, from, to } = opts;
  return useQuery({
    queryKey: [KEY, "time", accountId, from, to],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountTimeEntry[]> =>
      (await fetchAccountTimeEntries({
        data: { accountId: accountId!, ...(from ? { from } : {}), ...(to ? { to } : {}) },
      })) as AccountTimeEntry[],
  });
}
