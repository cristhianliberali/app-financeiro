import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskKanban } from "@/components/tasks/TaskKanban";
import { TaskListView } from "@/components/tasks/TaskListView";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useMoveTask, useTasks, type Task } from "@/lib/tasks";
import { BOARD_VIEWS, POLARITIES, type BoardView } from "@/lib/tasks-analytics";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tarefas/minhas")({
  head: () => ({
    meta: [
      { title: "Minhas tarefas — Tarefas e Projetos" },
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
  const move = useMoveTask();
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
   * tarefas vêm de quadros diferentes. Ao mover, a tarefa recebe o primeiro
   * status daquela polaridade dentro do próprio quadro.
   */
  async function moveByPolarity(task: Task, polarity: string) {
    const { data, error } = await supabase
      .from("board_statuses")
      .select("id,name")
      .eq("board_id", task.board_id)
      .eq("polarity", polarity)
      .order("sort_order")
      .limit(1);
    if (error) {
      toast.error(error.message);
      return;
    }
    const target = (data ?? [])[0];
    if (!target) {
      toast.error(`O quadro “${task.board.name}” não possui status com a polaridade selecionada.`);
      return;
    }
    await move.mutateAsync({ id: task.id, status_id: target.id as string });
    toast.success(`“${task.title}” movida para ${target.name as string}`);
  }

  return (
    <AppShell hideFinanceControls>
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
          onMove={(task, columnId) => moveByPolarity(task, columnId)}
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
    </AppShell>
  );
}
