import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useBoards, useSpaces, useTasks, type Task } from "@/lib/tasks";

export const Route = createFileRoute("/tarefas/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Tarefas e subtarefas com datas em visualização mensal, semanal ou diária, de todos os quadros.",
      },
    ],
  }),
  component: CalendarPage,
});

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring";

function CalendarPage() {
  const { accountId, users, currentUserId } = useTasksModule();
  const { data: allTasks = [] } = useTasks({ accountId });
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const [spaceId, setSpaceId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const { data: statuses = [] } = useBoardStatuses(selected?.board_id ?? null);

  const tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          (!spaceId || t.space.id === spaceId) &&
          (!boardId || t.board_id === boardId) &&
          (!responsible || t.responsible_user_id === responsible),
      ),
    [allTasks, spaceId, boardId, responsible],
  );

  const openTask = selected ? (allTasks.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <TasksShell breadcrumbCurrent="Calendário">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendário</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tarefas e subtarefas com datas definidas, de todos os espaços e quadros a que você tem
          acesso.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className={SELECT_CLASS}
          value={spaceId}
          onChange={(e) => {
            setSpaceId(e.target.value);
            setBoardId("");
          }}
        >
          <option value="">Todos os espaços</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.icon} {s.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
        >
          <option value="">Todos os quadros</option>
          {boards
            .filter((b) => !spaceId || b.space_id === spaceId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
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
      </div>

      <TaskCalendar tasks={tasks} users={users} onOpen={setSelected} />

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
