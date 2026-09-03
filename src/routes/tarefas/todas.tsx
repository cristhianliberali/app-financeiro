import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import {
  EMPTY_FILTERS,
  TaskFilterBar,
  filterTasks,
  type TaskFilterState,
} from "@/components/tasks/TaskFilterBar";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { columnOfTask, groupStatusesByName } from "@/components/tasks/kanban-columns";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useTone } from "@/hooks/use-tone";
import {
  useAccountStatuses,
  useBoardStatuses,
  useBoards,
  useLabels,
  useMoveTask,
  useSpaces,
  useTasks,
  type Task,
} from "@/lib/tasks";
import { BOARD_VIEWS, type BoardView } from "@/lib/tasks-analytics";

export const Route = createFileRoute("/tarefas/todas")({
  head: () => ({
    meta: [
      { title: "Tarefas — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Todas as tarefas da conta em Kanban, lista ou calendário, com os quadros de todos os espaços reunidos.",
      },
    ],
  }),
  component: AllTasksPage,
});

/**
 * Todas as tarefas da conta, nas mesmas três visões do quadro.
 *
 * É a tela do espaço um nível acima: lá as tarefas vêm dos quadros de um
 * espaço, aqui vêm dos quadros de todos os espaços visíveis. O Kanban usa a
 * mesma reunião de status por nome — "Em andamento" de sete quadros é uma
 * coluna só, e a coluna lembra qual status ela é dentro de cada quadro, que é
 * o que o arraste consulta para mover a tarefa para o status certo do quadro
 * dela.
 *
 * Diferente de "Minhas tarefas", que recorta pelo usuário logado: aqui não há
 * recorte nenhum além da visibilidade dos espaços, que o servidor já aplica.
 */
function AllTasksPage() {
  const { accountId, users, currentUserId, toggleTimer } = useTasksModule();
  const tone = useTone();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const { data: allTasks = [] } = useTasks({ accountId });
  const { data: statuses = [] } = useAccountStatuses(accountId);
  const { data: labels = [] } = useLabels(accountId);
  const move = useMoveTask();

  const [view, setView] = useState<BoardView>("kanban");
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_FILTERS);
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    task: Task | null;
    boardId: string | null;
    statusId?: string;
  }>({ open: false, task: null, boardId: null });
  /** Coluna escolhida quando ainda falta decidir em qual quadro a tarefa nasce. */
  const [pickBoard, setPickBoard] = useState<{ columnId: string; columnName: string } | null>(null);

  const activeBoards = useMemo(() => boards.filter((b) => !b.archived_at), [boards]);
  const tasks = useMemo(() => filterTasks(allTasks, filters), [allTasks, filters]);
  const columns = useMemo(() => groupStatusesByName(statuses, boards), [statuses, boards]);

  const spaceName = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);

  // O diálogo precisa dos status do quadro da própria tarefa.
  const dialogBoardId = taskDialog.task?.board_id ?? taskDialog.boardId;
  const { data: dialogStatuses = [] } = useBoardStatuses(dialogBoardId);

  /** Abre a criação já no quadro certo, resolvendo o status daquela coluna. */
  function createIn(columnId: string, boardId: string) {
    const column = columns.find((c) => c.id === columnId);
    const statusId = column?.statusByBoard.get(boardId);
    setTaskDialog({
      open: true,
      task: null,
      boardId,
      ...(statusId ? { statusId } : {}),
    });
  }

  function requestCreate(columnId: string) {
    const column = columns.find((c) => c.id === columnId);
    // Só faz sentido oferecer os quadros que têm essa coluna.
    const candidates = activeBoards.filter((b) => column?.statusByBoard.has(b.id));
    if (candidates.length === 1) {
      createIn(columnId, candidates[0]!.id);
      return;
    }
    setPickBoard({ columnId, columnName: column?.name ?? "" });
  }

  async function moveToColumn(task: Task, columnId: string) {
    const column = columns.find((c) => c.id === columnId);
    const statusId = column?.statusByBoard.get(task.board_id);
    if (!statusId) {
      toast.error(`O quadro “${task.board.name}” não tem o status “${column?.name ?? ""}”.`);
      return;
    }
    try {
      await move.mutateAsync({ id: task.id, status_id: statusId });
      toast.success(`“${task.title}” movida para ${column!.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
    }
  }

  // Mantém o diálogo sincronizado com os dados recarregados.
  const openTask = taskDialog.task
    ? (allTasks.find((t) => t.id === taskDialog.task!.id) ?? taskDialog.task)
    : null;

  const candidateBoards = activeBoards.filter((b) =>
    columns.find((c) => c.id === pickBoard?.columnId)?.statusByBoard.has(b.id),
  );

  return (
    // As mesmas três grades do quadro, reunindo a conta inteira.
    <TasksShell breadcrumbCurrent="Tarefas" wide>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-48 flex-1">
          <h1 className="title-xl truncate">Tarefas</h1>
          <p className="truncate text-xs text-muted-foreground">
            Todas as tarefas da conta, de {activeBoards.length} quadro(s) em {spaces.length}{" "}
            espaço(s), com os status de mesmo nome reunidos numa coluna só.
          </p>
        </div>

        {activeBoards.length > 0 && (
          // Sem `shrink-0`: ele vazava a barra para fora da tela no celular.
          // Ver o comentário em `quadros/$boardId.tsx`.
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {view !== "list" && (
              <TaskFilterBar
                value={filters}
                onChange={setFilters}
                labels={labels}
                users={users}
                boards={activeBoards}
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
        )}
      </div>

      {activeBoards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum quadro nesta conta ainda. As tarefas vivem dentro de quadros, que ficam dentro
            dos espaços.
          </p>
          <Button asChild className="mt-4">
            <Link to="/tarefas/espacos">Ir para Espaços</Link>
          </Button>
        </div>
      ) : (
        <>
          {view === "kanban" && (
            <TaskKanban
              columns={columns}
              tasks={tasks}
              users={users}
              currentUserId={currentUserId}
              showBoard
              columnOf={(t) => columnOfTask(columns, t)}
              onMove={(task, columnId) => void moveToColumn(task, columnId)}
              onOpen={(task) => setTaskDialog({ open: true, task, boardId: task.board_id })}
              onToggleTimer={toggleTimer}
              onAdd={requestCreate}
            />
          )}

          {view === "list" && (
            <TaskListView
              tasks={allTasks}
              users={users}
              currentUserId={currentUserId}
              showBoard
              onOpen={(task) => setTaskDialog({ open: true, task, boardId: task.board_id })}
              onToggleTimer={toggleTimer}
            />
          )}

          {view === "calendar" && (
            <TaskCalendar
              tasks={tasks}
              users={users}
              onOpen={(task) => setTaskDialog({ open: true, task, boardId: task.board_id })}
            />
          )}
        </>
      )}

      <Dialog open={!!pickBoard} onOpenChange={(open) => !open && setPickBoard(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Em qual quadro?</DialogTitle>
            <DialogDescription>
              A coluna “{pickBoard?.columnName}” existe em mais de um quadro da conta. A tarefa
              nasce no quadro escolhido.
            </DialogDescription>
          </DialogHeader>
          {/* A conta inteira cabe aqui: a lista rola, e cada quadro vem com o
              espaço dele, que é o que distingue dois "Marketing". */}
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {candidateBoards.map((board) => (
              <button
                key={board.id}
                onClick={() => {
                  createIn(pickBoard!.columnId, board.id);
                  setPickBoard(null);
                }}
                className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-accent"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tone(board.color) }}
                />
                <span className="min-w-0 flex-1 truncate">{board.name}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {spaceName.get(board.space_id) ?? ""}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {dialogBoardId && (
        <TaskDialog
          open={taskDialog.open}
          onOpenChange={(open) =>
            open ? undefined : setTaskDialog({ open: false, task: null, boardId: null })
          }
          task={openTask}
          boardId={dialogBoardId}
          statuses={dialogStatuses}
          users={users}
          currentUserId={currentUserId}
          {...(taskDialog.statusId ? { defaultStatusId: taskDialog.statusId } : {})}
        />
      )}
    </TasksShell>
  );
}
