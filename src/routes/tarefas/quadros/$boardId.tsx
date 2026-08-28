import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Plus, Settings2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { BoardDialog } from "@/components/tasks/BoardDialog";
import { StatusManagerDialog } from "@/components/tasks/StatusManagerDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import {
  useBoard,
  useBoardStatuses,
  useMoveTask,
  useSpaces,
  useTasks,
  type Task,
} from "@/lib/tasks";
import { BOARD_VIEWS, formatDateTimeBR, type BoardView } from "@/lib/tasks-analytics";

export const Route = createFileRoute("/tarefas/quadros/$boardId")({
  validateSearch: (search: Record<string, unknown>): { task?: string } =>
    typeof search["task"] === "string" ? { task: search["task"] } : {},
  head: () => ({
    meta: [
      { title: "Quadro — Tarefas e Projetos" },
      {
        name: "description",
        content:
          "Acompanhe as tarefas do quadro em Kanban, lista ou calendário, com responsáveis, prazos e tempo registrado.",
      },
    ],
  }),
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = Route.useParams();
  const { task: taskParam } = Route.useSearch();
  const navigate = useNavigate();
  const { accountId, users, currentUserId, toggleTimer } = useTasksModule();

  const { data: board } = useBoard(boardId);
  const { data: statuses = [] } = useBoardStatuses(boardId);
  const { data: tasks = [] } = useTasks({ accountId, boardId });
  const { data: spaces = [] } = useSpaces(accountId);
  const move = useMoveTask();

  const [view, setView] = useState<BoardView>("kanban");
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    task: Task | null;
    statusId?: string;
  }>({ open: false, task: null });
  const [boardDialog, setBoardDialog] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);

  useEffect(() => {
    if (board?.default_view) setView(board.default_view);
  }, [board?.default_view]);

  // Abre a tarefa indicada na URL (ex.: ao clicar no cronômetro global).
  useEffect(() => {
    if (!taskParam) return;
    const found = tasks.find((t) => t.id === taskParam);
    if (found) setTaskDialog({ open: true, task: found });
  }, [taskParam, tasks]);

  // Mantém o diálogo sincronizado com os dados recarregados.
  const openTask = taskDialog.task
    ? (tasks.find((t) => t.id === taskDialog.task!.id) ?? taskDialog.task)
    : null;

  const columns = useMemo(
    () => statuses.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    [statuses],
  );

  function closeTaskDialog() {
    setTaskDialog({ open: false, task: null });
    if (taskParam) {
      void navigate({
        to: "/tarefas/quadros/$boardId",
        params: { boardId },
        search: {},
      });
    }
  }

  return (
    <AppShell
      hideFinanceControls
      breadcrumb={
        <div className="flex items-center gap-1.5 text-sm">
          <Link
            to="/tarefas/espacos/$spaceId"
            params={{ spaceId: board?.space_id ?? "" }}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {board?.space.icon} {board?.space.name ?? "Espaço"}
          </Link>
          <span className="text-muted-foreground">›</span>
          <span className="font-medium">{board?.name ?? "Quadro"}</span>
        </div>
      }
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setStatusDialog(true)}>
            <Settings2 className="mr-1 size-3.5" /> Status
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBoardDialog(true)}>
            Editar quadro
          </Button>
          <Button
            size="sm"
            onClick={() => setTaskDialog({ open: true, task: null })}
            disabled={statuses.length === 0}
          >
            <Plus className="mr-1 size-3.5" /> Nova tarefa
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{board?.name ?? "Quadro"}</h1>
          {board?.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{board.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {board?.owner_id
              ? `Responsável: ${users.find((u) => u.user_id === board.owner_id)?.name ?? "—"}`
              : "Sem responsável"}
            {board?.start_date && ` · Início ${formatDateTimeBR(board.start_date, false)}`}
            {board?.due_date && ` · Previsão ${formatDateTimeBR(board.due_date, false)}`}
          </p>
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {BOARD_VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                view === v.value
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "kanban" && (
        <TaskKanban
          columns={columns}
          tasks={tasks}
          users={users}
          currentUserId={currentUserId}
          columnOf={(t) => t.status_id}
          onMove={async (task, columnId) => {
            await move.mutateAsync({ id: task.id, status_id: columnId });
            const name = statuses.find((s) => s.id === columnId)?.name ?? "";
            toast.success(`“${task.title}” movida para ${name}`);
          }}
          onOpen={(task) => setTaskDialog({ open: true, task })}
          onToggleTimer={toggleTimer}
          onAdd={(columnId) => setTaskDialog({ open: true, task: null, statusId: columnId })}
        />
      )}

      {view === "list" && (
        <TaskListView
          tasks={tasks}
          users={users}
          currentUserId={currentUserId}
          onOpen={(task) => setTaskDialog({ open: true, task })}
          onToggleTimer={toggleTimer}
        />
      )}

      {view === "calendar" && (
        <TaskCalendar
          tasks={tasks}
          users={users}
          onOpen={(task) => setTaskDialog({ open: true, task })}
        />
      )}

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => (open ? undefined : closeTaskDialog())}
        task={openTask}
        boardId={boardId}
        statuses={statuses}
        users={users}
        currentUserId={currentUserId}
        {...(taskDialog.statusId ? { defaultStatusId: taskDialog.statusId } : {})}
      />

      {board && (
        <BoardDialog
          open={boardDialog}
          onOpenChange={setBoardDialog}
          spaces={spaces}
          defaultSpaceId={board.space_id}
          board={board}
          users={users}
        />
      )}

      <StatusManagerDialog
        open={statusDialog}
        onOpenChange={setStatusDialog}
        boardId={boardId}
        statuses={statuses}
      />
    </AppShell>
  );
}
