import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TasksShell } from "@/components/tasks/TasksShell";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useMoveTaskByPolarity, useTasks, type Task } from "@/lib/tasks";
import { BOARD_VIEWS, POLARITIES, type BoardView, type Polarity } from "@/lib/tasks-analytics";

export const Route = createFileRoute("/tarefas/minhas")({
  head: () => ({
    meta: [
      { title: "Minhas tarefas — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Todas as tarefas em que você é responsável ou participante, reunidas de todos os quadros.",
      },
    ],
  }),
  component: MyTasksPage,
});

function MyTasksPage() {
  const { accountId, users, currentUserId, toggleTimer } = useTasksModule();
  const { data: allTasks = [] } = useTasks({ accountId });
  const moveByPolarity = useMoveTaskByPolarity();
  const [view, setView] = useState<BoardView>("list");
  const [selected, setSelected] = useState<Task | null>(null);
  const { data: statuses = [] } = useBoardStatuses(selected?.board_id ?? null);

  const tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.responsible_user_id === currentUserId ||
          (currentUserId ? t.participants.includes(currentUserId) : false),
      ),
    [allTasks, currentUserId],
  );

  const openTask = selected ? (tasks.find((t) => t.id === selected.id) ?? selected) : null;

  /**
   * No Kanban de "Minhas Tarefas" as colunas são as polaridades, pois as
   * tarefas vêm de quadros diferentes. O servidor resolve qual status daquela
   * polaridade usar dentro do quadro da própria tarefa.
   */
  async function moveToPolarity(task: Task, polarity: Polarity) {
    try {
      const result = await moveByPolarity.mutateAsync({ id: task.id, polarity });
      if (!result) {
        toast.error(`O quadro “${task.board.name}” não possui status com essa polaridade.`);
        return;
      }
      toast.success(`“${task.title}” movida para ${result.statusName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
    }
  }

  return (
    <TasksShell breadcrumbCurrent="Minhas tarefas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Minhas tarefas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tarefas de todos os quadros em que você é responsável ou participante.
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

      {view === "list" && (
        <TaskListView
          tasks={tasks}
          users={users}
          currentUserId={currentUserId}
          showBoard
          onOpen={setSelected}
          onToggleTimer={toggleTimer}
        />
      )}

      {view === "kanban" && (
        <TaskKanban
          columns={POLARITIES.map((p) => ({
            id: p.value,
            name: p.label,
            color: p.color,
            hint: p.hint,
          }))}
          tasks={tasks}
          users={users}
          currentUserId={currentUserId}
          showBoard
          columnOf={(t) => t.status?.polarity ?? null}
          onMove={(task, columnId) => moveToPolarity(task, columnId as Polarity)}
          onOpen={setSelected}
          onToggleTimer={toggleTimer}
        />
      )}

      {view === "calendar" && <TaskCalendar tasks={tasks} users={users} onOpen={setSelected} />}

      {openTask && (
        <TaskDialog
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          task={openTask}
          boardId={openTask.board_id}
          statuses={statuses}
          users={users}
          currentUserId={currentUserId}
        />
      )}
    </TasksShell>
  );
}
