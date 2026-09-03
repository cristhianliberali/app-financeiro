import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BoardDialog } from "@/components/tasks/BoardDialog";
import { SpaceDialog } from "@/components/tasks/SpaceDialog";
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
  useBoardStatuses,
  useBoards,
  useLabels,
  useMoveTask,
  useSpaceStatuses,
  useSpaces,
  useTasks,
  type Board,
  type Task,
} from "@/lib/tasks";
import { BOARD_VIEWS, type BoardView } from "@/lib/tasks-analytics";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";
import { resumirTitulo } from "@/lib/task-title";

export const Route = createFileRoute("/tarefas/espacos/$spaceId")({
  head: () => ({
    meta: [
      { title: "Quadros do espaço — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Quadros do espaço e todas as suas tarefas em Kanban, lista ou calendário, com os status dos quadros reunidos.",
      },
    ],
  }),
  component: SpacePage,
});

function SpacePage() {
  const { spaceId } = Route.useParams();
  const navigate = useNavigate();
  const { accountId, users, currentUserId, toggleTimer } = useTasksModule();
  const tone = useTone();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId, spaceId });
  const { data: allTasks = [] } = useTasks({ accountId });
  const { data: statuses = [] } = useSpaceStatuses(spaceId);
  const { data: labels = [] } = useLabels(accountId);
  const move = useMoveTask();

  const [boardDialog, setBoardDialog] = useState<{ open: boolean; board: Board | null }>({
    open: false,
    board: null,
  });
  const [spaceDialog, setSpaceDialog] = useState(false);
  const [view, setView] = useState<BoardView>("kanban");
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_FILTERS);
  const [taskDialog, setTaskDialog] = useState<{
    open: boolean;
    task: Task | null;
    boardId: string | null;
    statusId?: string;
  }>({ open: false, task: null, boardId: null });
  /** Coluna escolhida quando o espaço tem mais de um quadro e falta decidir onde criar. */
  const [pickBoard, setPickBoard] = useState<{ columnId: string; columnName: string } | null>(null);

  const space = spaces.find((s) => s.id === spaceId) ?? null;

  const spaceTasks = useMemo(
    () => allTasks.filter((t) => t.board.space_id === spaceId),
    [allTasks, spaceId],
  );
  const tasks = useMemo(() => filterTasks(spaceTasks, filters), [spaceTasks, filters]);

  const columns = useMemo(() => groupStatusesByName(statuses, boards), [statuses, boards]);

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
    const candidates = boards.filter((b) => column?.statusByBoard.has(b.id));
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
      toast.success(`“${resumirTitulo(task.title)}” movida para ${column!.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
    }
  }

  const subtitle =
    space?.description ??
    `Tarefas dos ${boards.length} quadro(s) deste espaço, com os status iguais reunidos numa coluna só.`;

  // Mantém o diálogo sincronizado com os dados recarregados.
  const openTask = taskDialog.task
    ? (allTasks.find((t) => t.id === taskDialog.task!.id) ?? taskDialog.task)
    : null;

  return (
    <TasksShell
      spaceId={spaceId}
      // As mesmas três grades do quadro, reunindo os quadros do espaço.
      wide
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setSpaceDialog(true)}>
            <Pencil className="mr-1 size-3.5" /> Editar espaço
          </Button>
          <Button size="sm" onClick={() => setBoardDialog({ open: true, board: null })}>
            <Plus className="mr-1 size-3.5" /> Novo quadro
          </Button>
        </>
      }
    >
      {/*
        A tela do espaço é a das tarefas dele. Os quadros ficam na lateral, que
        é de onde se escolhe um — repeti-los aqui em cartões era um índice a
        mais para atravessar antes de chegar no trabalho.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-56 flex-1 items-center gap-3">
          <IconBadge
            name={space?.icon}
            color={space?.color}
            size="lg"
            fallback={DEFAULT_SPACE_ICON}
          />
          <div className="min-w-0">
            <h1 className="title-xl truncate">{space?.name ?? "Espaço"}</h1>
            <p className="truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </p>
          </div>
        </div>

        {boards.length > 0 && (
          // Sem `shrink-0` pelo mesmo motivo do quadro: ele vazava a barra para
          // fora da tela no celular. Ver o comentário em `quadros/$boardId.tsx`.
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {view !== "list" && (
              <TaskFilterBar
                value={filters}
                onChange={setFilters}
                labels={labels}
                users={users}
                boards={boards}
                shown={tasks.length}
                total={spaceTasks.length}
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

      {boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum quadro neste espaço. Um quadro representa um projeto, processo ou fluxo de
            trabalho.
          </p>
          <Button className="mt-4" onClick={() => setBoardDialog({ open: true, board: null })}>
            <Plus className="mr-1 size-3.5" /> Criar quadro
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
              tasks={spaceTasks}
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
              A coluna “{pickBoard?.columnName}” existe em mais de um quadro deste espaço. A tarefa
              nasce no quadro escolhido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {boards
              .filter((b) =>
                columns.find((c) => c.id === pickBoard?.columnId)?.statusByBoard.has(b.id),
              )
              .map((board) => (
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
                  {board.name}
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

      <BoardDialog
        open={boardDialog.open}
        onOpenChange={(open) => setBoardDialog({ open, board: open ? boardDialog.board : null })}
        spaces={spaces}
        defaultSpaceId={spaceId}
        board={boardDialog.board}
        onCreated={(boardId) =>
          navigate({ to: "/tarefas/quadros/$boardId", params: { boardId }, search: {} })
        }
      />

      <SpaceDialog
        open={spaceDialog}
        onOpenChange={setSpaceDialog}
        accountId={accountId}
        space={space}
      />
    </TasksShell>
  );
}
