import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BoardStage, BoardView, Polarity, StatusSeed } from "./tasks-analytics";

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

export type TimeEntry = {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  note?: string | null;
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
  /** Soma dos registros já encerrados, em segundos. */
  trackedSeconds: number;
  /** Registro em execução, quando houver. */
  running: TimeEntry | null;
};

export type AccountUser = { user_id: string; email: string | null; name: string };

export type ActiveTimer = TimeEntry & { task: { id: string; title: string; board_id: string } };

const KEY = "tp"; // prefixo único do módulo Tarefas e Projetos

async function userId() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sessão expirada");
  return data.user.id;
}

// ---------------------------------------------------------------------------
// Usuários da conta
// ---------------------------------------------------------------------------

export function useAccountUsers(accountId: string | null) {
  return useQuery({
    queryKey: [KEY, "users", accountId],
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccountUser[]> => {
      const { data, error } = await supabase.rpc("account_users", { _account_id: accountId! });
      if (error) throw error;
      return (data ?? []) as AccountUser[];
    },
  });
}

// ---------------------------------------------------------------------------
// Espaços
// ---------------------------------------------------------------------------

const SPACE_COLS = "id,account_id,name,description,icon,color,created_by,created_at,archived_at";

export function useSpaces(accountId: string | null) {
  return useQuery({
    queryKey: [KEY, "spaces", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<Space[]> => {
      const { data, error } = await supabase
        .from("spaces")
        .select(SPACE_COLS)
        .eq("account_id", accountId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Space[];
    },
  });
}

export function useSpaceMembers(spaceId: string | null) {
  return useQuery({
    queryKey: [KEY, "space-members", spaceId],
    enabled: !!spaceId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("space_members")
        .select("user_id")
        .eq("space_id", spaceId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
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
    }) => {
      const uid = await userId();
      const payload = {
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
        archived_at: input.archived ? new Date().toISOString() : null,
      };
      let spaceId = input.id;
      if (spaceId) {
        const { error } = await supabase.from("spaces").update(payload).eq("id", spaceId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("spaces")
          .insert({ ...payload, account_id: accountId!, created_by: uid })
          .select("id")
          .single();
        if (error) throw error;
        spaceId = data.id as string;
      }

      if (input.memberIds) {
        const { error: delErr } = await supabase
          .from("space_members")
          .delete()
          .eq("space_id", spaceId);
        if (delErr) throw delErr;
        if (input.memberIds.length) {
          const { error: insErr } = await supabase
            .from("space_members")
            .insert(input.memberIds.map((user_id) => ({ space_id: spaceId!, user_id })));
          if (insErr) throw insErr;
        }
      }
      return spaceId!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("spaces").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Quadros
// ---------------------------------------------------------------------------

const BOARD_COLS =
  "id,space_id,name,description,owner_id,start_date,due_date,status,default_view,color,created_by,created_at,archived_at";

/** Quadros de um espaço; sem espaço informado, todos os quadros visíveis da conta. */
export function useBoards(opts: { accountId: string | null; spaceId?: string | null }) {
  const { accountId, spaceId = null } = opts;
  return useQuery({
    queryKey: [KEY, "boards", accountId, spaceId],
    enabled: !!accountId,
    queryFn: async (): Promise<Board[]> => {
      let q = supabase
        .from("boards")
        .select(`${BOARD_COLS},spaces!inner(id,account_id)`)
        .eq("spaces.account_id", accountId!);
      if (spaceId) q = q.eq("space_id", spaceId);
      const { data, error } = await q.order("created_at");
      if (error) throw error;
      return (data ?? []).map(({ spaces: _spaces, ...b }) => b) as Board[];
    },
  });
}

export function useBoard(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "board", boardId],
    enabled: !!boardId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boards")
        .select(`${BOARD_COLS},spaces!inner(id,name,icon,color,account_id)`)
        .eq("id", boardId!)
        .single();
      if (error) throw error;
      const { spaces, ...board } = data as never as Board & {
        spaces: { id: string; name: string; icon: string; color: string; account_id: string };
      };
      return { ...board, space: spaces };
    },
  });
}

export function useBoardMembers(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "board-members", boardId],
    enabled: !!boardId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("board_members")
        .select("user_id")
        .eq("board_id", boardId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
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
    }) => {
      const { data, error } = await supabase.rpc("create_board_with_statuses", {
        _space_id: input.spaceId,
        _name: input.name,
        _statuses: input.statuses as never,
        _description: input.description,
        _owner_id: input.ownerId,
        _start_date: input.startDate,
        _due_date: input.dueDate,
        _default_view: input.defaultView,
        _color: input.color,
      });
      if (error) throw error;
      const boardId = data as string;
      if (input.memberIds.length) {
        const { error: mErr } = await supabase
          .from("board_members")
          .insert(input.memberIds.map((user_id) => ({ board_id: boardId, user_id })));
        if (mErr) throw mErr;
      }
      return boardId;
    },
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
      const { error } = await supabase.from("boards").update(input.patch).eq("id", input.id);
      if (error) throw error;
      if (input.memberIds) {
        const { error: delErr } = await supabase
          .from("board_members")
          .delete()
          .eq("board_id", input.id);
        if (delErr) throw delErr;
        if (input.memberIds.length) {
          const { error: insErr } = await supabase
            .from("board_members")
            .insert(input.memberIds.map((user_id) => ({ board_id: input.id, user_id })));
          if (insErr) throw insErr;
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("boards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Status do quadro
// ---------------------------------------------------------------------------

const STATUS_COLS = "id,board_id,name,sort_order,color,polarity,is_default";

export function useBoardStatuses(boardId: string | null) {
  return useQuery({
    queryKey: [KEY, "statuses", boardId],
    enabled: !!boardId,
    queryFn: async (): Promise<BoardStatus[]> => {
      const { data, error } = await supabase
        .from("board_statuses")
        .select(STATUS_COLS)
        .eq("board_id", boardId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as BoardStatus[];
    },
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
      is_default?: boolean;
    }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await supabase.from("board_statuses").update(rest).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase
        .from("board_statuses")
        .insert({ ...rest, board_id: boardId! })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useReorderStatuses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ordered: Array<{ id: string; sort_order: number }>) => {
      for (const row of ordered) {
        const { error } = await supabase
          .from("board_statuses")
          .update({ sort_order: row.sort_order })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; moveToStatusId: string | null }) => {
      // As tarefas do status removido são movidas para outro status do quadro.
      if (input.moveToStatusId) {
        const { error } = await supabase
          .from("tasks")
          .update({ status_id: input.moveToStatusId })
          .eq("status_id", input.id);
        if (error) throw error;
      }
      const { error } = await supabase.from("board_statuses").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

const TASK_SELECT = `
  id,board_id,status_id,title,description,responsible_user_id,start_date,due_date,sort_order,
  created_by,created_at,completed_at,archived_at,
  board_statuses(${STATUS_COLS}),
  boards!inner(id,name,color,space_id,spaces!inner(id,name,icon,color,account_id)),
  task_participants(user_id),
  subtasks(id,task_id,title,responsible_user_id,start_date,due_date,completed,completed_at,sort_order),
  time_entries(id,task_id,user_id,started_at,stopped_at,duration_seconds)
`;

type RawTask = Omit<
  Task,
  "status" | "board" | "space" | "participants" | "trackedSeconds" | "running"
> & {
  board_statuses: BoardStatus | null;
  boards: {
    id: string;
    name: string;
    color: string;
    space_id: string;
    spaces: { id: string; name: string; icon: string; color: string; account_id: string };
  };
  task_participants: Array<{ user_id: string }>;
  time_entries: TimeEntry[];
};

function normalize(row: RawTask): Task {
  const entries = (row.time_entries ?? [])
    .slice()
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const running = entries.find((e) => !e.stopped_at) ?? null;
  return {
    ...row,
    status: row.board_statuses ?? null,
    board: {
      id: row.boards.id,
      name: row.boards.name,
      color: row.boards.color,
      space_id: row.boards.space_id,
    },
    space: {
      id: row.boards.spaces.id,
      name: row.boards.spaces.name,
      icon: row.boards.spaces.icon,
      color: row.boards.spaces.color,
    },
    participants: (row.task_participants ?? []).map((p) => p.user_id),
    subtasks: (row.subtasks ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    entries,
    trackedSeconds: entries.reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0),
    running,
  };
}

/** Tarefas de um quadro, ou de toda a conta quando `boardId` não é informado. */
export function useTasks(opts: { accountId: string | null; boardId?: string | null }) {
  const { accountId, boardId = null } = opts;
  return useQuery({
    queryKey: [KEY, "tasks", accountId, boardId],
    enabled: !!accountId,
    queryFn: async (): Promise<Task[]> => {
      let q = supabase.from("tasks").select(TASK_SELECT).eq("boards.spaces.account_id", accountId!);
      if (boardId) q = q.eq("board_id", boardId);
      const { data, error } = await q.order("sort_order").limit(5000);
      if (error) throw error;
      return (data ?? []).map((r) => normalize(r as never as RawTask));
    },
  });
}

export function useTaskActivity(taskId: string | null) {
  return useQuery({
    queryKey: [KEY, "activity", taskId],
    enabled: !!taskId,
    queryFn: async (): Promise<TaskActivity[]> => {
      const { data, error } = await supabase
        .from("task_activity")
        .select("id,task_id,user_id,action,meta,created_at")
        .eq("task_id", taskId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as never as TaskActivity[];
    },
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
      start_date?: string | null;
      due_date?: string | null;
      sort_order?: number;
      participantIds?: string[];
    }) => {
      const { id, participantIds, ...rest } = input;
      let taskId = id;
      if (taskId) {
        const { error } = await supabase.from("tasks").update(rest).eq("id", taskId);
        if (error) throw error;
      } else {
        const uid = await userId();
        const { data, error } = await supabase
          .from("tasks")
          .insert({ ...rest, created_by: uid })
          .select("id")
          .single();
        if (error) throw error;
        taskId = data.id as string;
      }

      if (participantIds) {
        const { data: current, error: cErr } = await supabase
          .from("task_participants")
          .select("id,user_id")
          .eq("task_id", taskId);
        if (cErr) throw cErr;
        const currentIds = (current ?? []).map((r) => r.user_id as string);
        const toRemove = (current ?? []).filter(
          (r) => !participantIds.includes(r.user_id as string),
        );
        const toAdd = participantIds.filter((u) => !currentIds.includes(u));
        if (toRemove.length) {
          const { error } = await supabase
            .from("task_participants")
            .delete()
            .in(
              "id",
              toRemove.map((r) => r.id as string),
            );
          if (error) throw error;
        }
        if (toAdd.length) {
          const { error } = await supabase
            .from("task_participants")
            .insert(toAdd.map((user_id) => ({ task_id: taskId!, user_id })));
          if (error) throw error;
        }
      }
      return taskId!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Move a tarefa para outro status (Kanban / drag and drop). */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status_id: string; sort_order?: number }) => {
      const { id, ...patch } = input;
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
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
      title: string;
      responsible_user_id?: string | null;
      start_date?: string | null;
      due_date?: string | null;
      completed?: boolean;
      sort_order?: number;
    }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await supabase.from("subtasks").update(rest).eq("id", id);
        if (error) throw error;
        return id;
      }
      const uid = await userId();
      const { data, error } = await supabase
        .from("subtasks")
        .insert({ ...rest, created_by: uid })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("subtasks").delete().eq("id", id);
      if (error) throw error;
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
    queryFn: async (): Promise<ActiveTimer | null> => {
      const uid = await userId();
      const { data, error } = await supabase
        .from("time_entries")
        .select(
          "id,task_id,user_id,started_at,stopped_at,duration_seconds,tasks(id,title,board_id)",
        )
        .eq("user_id", uid)
        .is("stopped_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as never as
        | (TimeEntry & {
            tasks: { id: string; title: string; board_id: string } | null;
          })
        | undefined;
      if (!row || !row.tasks) return null;
      const { tasks, ...entry } = row;
      return { ...entry, task: tasks };
    },
  });
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await supabase.rpc("start_task_timer", { _task_id: taskId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId?: string) => {
      const { error } = await supabase.rpc("stop_task_timer", { _entry_id: entryId ?? null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_entries").delete().eq("id", id);
      if (error) throw error;
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
    queryFn: async () => {
      let q = supabase
        .from("time_entries")
        .select(
          "id,task_id,user_id,started_at,stopped_at,duration_seconds,tasks!inner(id,title,board_id,boards!inner(id,name,space_id,spaces!inner(id,name,account_id)))",
        )
        .eq("tasks.boards.spaces.account_id", accountId!);
      if (from) q = q.gte("started_at", `${from}T00:00:00`);
      if (to) q = q.lte("started_at", `${to}T23:59:59`);
      const { data, error } = await q.order("started_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as never as TimeEntry & {
          tasks: {
            id: string;
            title: string;
            board_id: string;
            boards: {
              id: string;
              name: string;
              space_id: string;
              spaces: { id: string; name: string; account_id: string };
            };
          };
        };
        return {
          id: row.id,
          task_id: row.task_id,
          user_id: row.user_id,
          started_at: row.started_at,
          stopped_at: row.stopped_at,
          duration_seconds: row.duration_seconds,
          task_title: row.tasks.title,
          board_id: row.tasks.boards.id,
          board_name: row.tasks.boards.name,
          space_id: row.tasks.boards.spaces.id,
          space_name: row.tasks.boards.spaces.name,
        };
      });
    },
  });
}

export type AccountTimeEntry = ReturnType<typeof useAccountTimeEntries>["data"] extends
  (infer T)[] | undefined
  ? T
  : never;
