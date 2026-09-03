import { useNavigate } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { useNow } from "@/hooks/use-now";
import { useActiveTimer, useStopTimer } from "@/lib/tasks";
import { formatClock } from "@/lib/tasks-analytics";
import { resumirTitulo } from "@/lib/task-title";

/**
 * Cronômetro ativo do usuário, exibido no cabeçalho de todo o aplicativo.
 * Permite pausar sem voltar até a tarefa.
 */
export function ActiveTimerBar() {
  const { data: timer } = useActiveTimer();
  const stop = useStopTimer();
  const navigate = useNavigate();
  const now = useNow();

  if (!timer) return null;

  const elapsed = Math.floor((now - new Date(timer.started_at).getTime()) / 1000);

  return (
    <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft py-1 pl-3 pr-1 text-sm shadow-xs">
      <Play className="pulse-alert size-3 shrink-0 fill-primary text-primary" />
      <button
        className="max-w-[10rem] truncate font-semibold hover:underline sm:max-w-xs"
        title={`Abrir ${timer.task.title}`}
        onClick={() =>
          navigate({
            to: "/tarefas/quadros/$boardId",
            params: { boardId: timer.task.board_id },
            search: { task: timer.task.id },
          })
        }
      >
        {resumirTitulo(timer.task.title)}
      </button>
      <span className="font-mono text-xs font-bold tabular-nums text-primary">
        {formatClock(elapsed)}
      </span>
      <button
        onClick={async () => {
          await stop.mutateAsync(timer.id);
          toast.success("Cronômetro pausado");
        }}
        disabled={stop.isPending}
        className="rounded-full p-1.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
        aria-label="Pausar cronômetro"
        title="Pausar cronômetro"
      >
        <Pause className="size-3.5" />
      </button>
    </div>
  );
}
