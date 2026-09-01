import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { AgendaCalendar } from "@/components/tasks/AgendaCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useTasks, type Task } from "@/lib/tasks";

export const Route = createFileRoute("/tarefas/agenda")({
  head: () => ({
    meta: [
      { title: "Minha Agenda — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Tarefas do app e compromissos do Google Agenda no mesmo calendário, por semana ou por mês.",
      },
    ],
  }),
  component: AgendaPage,
});

/**
 * Minha Agenda: as tarefas e a agenda conectada no mesmo lugar.
 *
 * É o calendário que funde as duas fontes e sabe sincronizar sozinho — por isso
 * ele é o calendário do menu. Ver o compromisso ao lado da tarefa é o ponto de
 * ter conectado a agenda, e para isso ele precisa da tela inteira.
 */
function AgendaPage() {
  const { users, currentUserId, accountId } = useTasksModule();
  const { data: allTasks = [] } = useTasks({ accountId });
  const [selected, setSelected] = useState<Task | null>(null);
  const { data: statuses = [] } = useBoardStatuses(selected?.board_id ?? null);

  // A tarefa aberta segue a lista: arrastar ou editar atualiza o calendário
  // atrás do diálogo, e o diálogo precisa mostrar o mesmo que ele.
  const openTask = selected ? (allTasks.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <TasksShell breadcrumbCurrent="Minha Agenda">
      <div>
        <h1 className="title-xl">Minha Agenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suas tarefas e os compromissos da agenda conectada, lado a lado.
        </p>
      </div>

      <AgendaCalendar tasks={allTasks} onOpenTask={setSelected} />

      {openTask && (
        <TaskDialog
          open
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
