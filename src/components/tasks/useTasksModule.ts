import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/lib/app-state";
import { useAccountUsers, useStartTimer, useStopTimer, type Task } from "@/lib/tasks";

/** Contexto compartilhado pelas telas de Tarefas e Projetos. */
export function useTasksModule() {
  const { accountId } = useAppState();
  const { user } = useAuth();
  const { data: users = [] } = useAccountUsers(accountId);
  const start = useStartTimer();
  const stop = useStopTimer();

  const currentUserId = user?.id ?? null;

  /** Alterna o cronômetro da tarefa para o usuário logado. */
  async function toggleTimer(task: Task) {
    try {
      if (task.running && task.running.user_id === currentUserId) {
        await stop.mutateAsync(task.running.id);
        toast.success("Cronômetro pausado");
      } else {
        await start.mutateAsync(task.id);
        toast.success(`Cronômetro iniciado em “${task.title}”`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o cronômetro");
    }
  }

  return { accountId, users, currentUserId, toggleTimer };
}
