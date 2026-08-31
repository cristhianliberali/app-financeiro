import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Settings2, X } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { BoardDialog } from "@/components/tasks/BoardDialog";
import { LabelFilter } from "@/components/tasks/LabelPicker";
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
  PRIORITIES,
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

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring";

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
  const [term, setTerm] = useState("");
  const [priority, setPriority] = useState("");
  const [responsible, setResponsible] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
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

  // A lista/calendário têm filtros próprios; estes aqui valem para o Kanban,
  // que é a visão sem filtro embutido.
  const tasks = useMemo(() => {
    const t = term.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (
        t &&
        !task.title.toLowerCase().includes(t) &&
        !task.labels.some((label) => label.name.toLowerCase().includes(t))
      ) {
        return false;
      }
      if (priority && task.priority !== priority) return false;
      if (responsible && (task.responsible_user_id ?? "") !== responsible) return false;
      if (
        labelFilter.length > 0 &&
        !labelFilter.every((id) => task.labels.some((label) => label.id === id))
      ) {
        return false;
      }
      return true;
    });
  }, [allTasks, term, priority, responsible, labelFilter]);

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

  const filtersActive = !!term || !!priority || !!responsible || labelFilter.length > 0;

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

      {view === "kanban" && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Pesquisar tarefas ou etiquetas…"
              className="pl-8"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Todas as prioridades</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <LabelFilter labels={labels} value={labelFilter} onChange={setLabelFilter} />
          <select
            className={SELECT_CLASS}
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
          >
            <option value="">Todos os responsáveis</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={() => {
                setTerm("");
                setPriority("");
                setResponsible("");
                setLabelFilter([]);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" /> Limpar filtros ({tasks.length}/{allTasks.length})
            </button>
          )}
        </div>
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
