import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Settings2 } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import type { QuickTaskDraft } from "@/components/tasks/QuickTaskForm";
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
  useSaveTask,
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
import { resumirTitulo } from "@/lib/task-title";

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
  const saveTask = useSaveTask();

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

  // Descrição e dados do quadro numa linha só: são contexto, não o assunto.
  const subtitle = [
    board?.description,
    board?.owner_id
      ? `Responsável: ${users.find((u) => u.user_id === board.owner_id)?.name ?? "—"}`
      : "Sem responsável",
    board?.start_date && `Início ${formatDateTimeBR(board.start_date, false)}`,
    board?.due_date && `Previsão ${formatDateTimeBR(board.due_date, false)}`,
    totals.estimated > 0 &&
      `${formatHours(totals.tracked)} de ${formatHours(totals.estimated)} estimadas`,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * Criação rápida na coluna: só nome, responsável e prazo.
   *
   * Erro não é engolido — quem acabou de digitar precisa saber que a linha não
   * entrou, e o formulário só limpa o nome depois que isto resolve.
   */
  async function quickAdd(columnId: string, draft: QuickTaskDraft) {
    try {
      await saveTask.mutateAsync({
        board_id: boardId,
        status_id: columnId,
        title: draft.title,
        responsible_user_id: draft.responsible_user_id,
        due_date: draft.due_date,
      });
      toast.success(`“${resumirTitulo(draft.title)}” criada`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a tarefa");
      throw error;
    }
  }

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
      // Kanban, lista e calendário são grades: aqui a largura vira conteúdo.
      wide
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
      {/*
        Título, filtros e seletor de visão numa linha só. Cada faixa a mais
        aqui em cima é altura que sai da coluna do Kanban.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {/* Piso de largura: abaixo disso o título vira reticência, e aí é melhor
            os filtros descerem para a linha de baixo. */}
        <div className="min-w-48 flex-1">
          <h1 className="title-xl truncate">{board?.name ?? "Quadro"}</h1>
          <p className="truncate text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </p>
        </div>

        {/*
          Sem `shrink-0`: era ele o começo do estrago. Ele mandava este grupo
          nunca encolher, e no celular a busca mais os três filtros mais as
          abas dão 847px numa tela de 390 — 473px vazando para fora. O
          contêiner da casca então rolava para o lado junto com o Kanban, que
          já tem a própria rolagem, e o quadro inteiro deslizava levando a
          busca e as abas consigo.

          Deixando encolher (`min-w-0`), o `flex-wrap` faz o que sempre soube
          fazer: os filtros descem de linha e cabem. A largura extra fica só
          com o Kanban, que é quem tem scroller para ela.
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
            toast.success(`“${resumirTitulo(task.title)}” movida para ${name}`);
          }}
          onOpen={(task) => setTaskDialog({ open: true, task })}
          onToggleTimer={toggleTimer}
          onAdd={(columnId) => setTaskDialog({ open: true, task: null, statusId: columnId })}
          onQuickAdd={quickAdd}
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
