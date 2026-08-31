import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { MyDay } from "@/components/tasks/MyDay";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useTasks, type Task } from "@/lib/tasks";

export const Route = createFileRoute("/tarefas/meu-dia")({
  head: () => ({
    meta: [
      { title: "Meu dia — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "O que vence hoje, o que ficou para trás e os compromissos da agenda, reunidos em uma tela.",
      },
    ],
  }),
  component: MyDayPage,
});

/**
 * Meu dia: o recorte de hoje, com tela própria.
 *
 * Era uma aba dentro da visão geral, e por isso só se chegava nele passando
 * antes pelo painel consolidado — que é justamente a leitura ampla que o dia de
 * trabalho não pede. Como entrada do menu, é o que se abre de manhã.
 */
function MyDayPage() {
  const { accountId, users, currentUserId } = useTasksModule();
  const { data: allTasks = [] } = useTasks({ accountId });
  const [selected, setSelected] = useState<Task | null>(null);
  const { data: statuses = [] } = useBoardStatuses(selected?.board_id ?? null);

  // A tarefa aberta segue a lista: editar pelo diálogo atualiza o que está atrás
  // dele, e o diálogo precisa mostrar o mesmo, não a cópia de quando abriu.
  const openTask = selected ? (allTasks.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <TasksShell breadcrumbCurrent="Meu dia">
      <div>
        <h1 className="title-xl">Meu dia</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que vence hoje, o que ficou para trás e os compromissos da sua agenda.
        </p>
      </div>

      <MyDay
        tasks={allTasks}
        currentUserId={currentUserId}
        accountId={accountId}
        onOpenTask={setSelected}
      />

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
