import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Settings2 } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { BoardDialog } from "@/components/tasks/BoardDialog";
import {
  EMPTY_FILTERS,
  TaskFilterBar,
  filterTasks,
  type TaskFilterState,
} from "@/components/tasks/TaskFilterBar";
import { StatusManagerDialog } from "@/components/tasks/StatusManagerDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import {
  useBoard,
  useBoardStatuses,
  useLabels,
  useMoveTask,
  useSpaces,
  useTasks,
  type Task,
} from "@/lib/tasks";
import {
  BOARD_VIEWS,
  formatDateTimeBR,
  formatHours,
  hoursOf,
  type BoardView,
} from "@/lib/tasks-analytics";

export const Route = createFileRoute("/tarefas/quadros/$boardId")({
  validateSearch: (search: Record<string, unknown>): { task?: string } =>
    typeof search["task"] === "string" ? { task: search["task"] } : {},
  head: () => ({
    meta: [
      { title: "Quadro — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Acompanhe as tarefas do quadro em Kanban, lista ou calendário, com responsáveis, prioridades, etiquetas, prazos e tempo registrado.",
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
  const { data: allTasks = [] } = useTasks({ accountId, boardId });
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: labels = [] } = useLabels(accountId);
  const move = useMoveTask();

  const [view, setView] = useState<BoardView>("kanban");
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_FILTERS);
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

  // Abre a tarefa indicada na URL (ex.: ao clicar no cronômetro global ou num lembrete).
  useEffect(() => {
    if (!taskParam) return;
    const found = allTasks.find((t) => t.id === taskParam);
    if (found) setTaskDialog({ open: true, task: found });
  }, [taskParam, allTasks]);

  // A lista tem filtros próprios, no cabeçalho da tabela; estes aqui valem
  // para o Kanban e o calendário, que não têm onde pendurá-los.
  const tasks = useMemo(() => filterTasks(allTasks, filters), [allTasks, filters]);

  // Mantém o diálogo sincronizado com os dados recarregados.
  const openTask = taskDialog.task
    ? (allTasks.find((t) => t.id === taskDialog.task!.id) ?? taskDialog.task)
    : null;

  const columns = useMemo(
    () => statuses.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    [statuses],
  );

  const totals = useMemo(() => {
    let estimated = 0;
    let tracked = 0;
    for (const task of tasks) {
      estimated += task.estimate_hours ?? 0;
      tracked += task.trackedSeconds;
    }
    return { estimated, tracked: hoursOf(tracked) };
  }, [tasks]);

  function closeTaskDialog() {
    setTaskDialog({ open: false, task: null });
    if (taskParam) {
      void navigate({ to: "/tarefas/quadros/$boardId", params: { boardId }, search: {} });
    }
  }

  return (
    <TasksShell
      spaceId={board?.space_id ?? null}
      boardId={boardId}
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
          <h1 className="title-xl">{board?.name ?? "Quadro"}</h1>
          {board?.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{board.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {board?.owner_id
              ? `Responsável: ${users.find((u) => u.user_id === board.owner_id)?.name ?? "—"}`
              : "Sem responsável"}
            {board?.start_date && ` · Início ${formatDateTimeBR(board.start_date, false)}`}
            {board?.due_date && ` · Previsão ${formatDateTimeBR(board.due_date, false)}`}
            {totals.estimated > 0 &&
              ` · ${formatHours(totals.tracked)} de ${formatHours(totals.estimated)} estimadas`}
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

      {view !== "list" && (
        <TaskFilterBar
          value={filters}
          onChange={setFilters}
          labels={labels}
          users={users}
          shown={tasks.length}
          total={allTasks.length}
        />
      )}

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
          tasks={allTasks}
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
        />
      )}

      <StatusManagerDialog
        open={statusDialog}
        onOpenChange={setStatusDialog}
        boardId={boardId}
        statuses={statuses}
        tasks={allTasks}
      />
    </TasksShell>
  );
}
