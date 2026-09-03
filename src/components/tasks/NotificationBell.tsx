import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpcomingReminders } from "@/lib/tasks";
import { formatDateTimeBR } from "@/lib/tasks-analytics";
import { resumirTitulo, tituloPorExtenso } from "@/lib/task-title";
import { useTaskNotifications } from "./useTaskNotifications";

/**
 * Sininho do cabeçalho: dispara as notificações dos lembretes vencidos e lista
 * os próximos agendados. Fica montado em toda a casca do módulo, por isso é
 * daqui que sai o aviso mesmo quando o usuário está em outra tela.
 */
export function NotificationBell({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { permission, requestPermission } = useTaskNotifications(enabled);
  const { data: upcoming = [] } = useUpcomingReminders(enabled);

  const needsPermission = permission === "default";
  const Icon = upcoming.length > 0 ? BellRing : permission === "denied" ? BellOff : Bell;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-xl border border-border bg-card p-2 text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
          aria-label="Lembretes"
          title="Lembretes"
        >
          <Icon className="size-4" />
          {upcoming.length > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[9px] font-bold text-negative-foreground shadow-xs">
              {upcoming.length > 9 ? "9+" : upcoming.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="text-sm font-bold tracking-tight">Lembretes</p>

        {needsPermission && (
          <div className="mt-2 rounded-xl border border-border bg-surface p-3">
            <p className="text-xs text-muted-foreground">
              Ative as notificações do navegador para receber os lembretes das tarefas mesmo com o
              app em outra aba.
            </p>
            <Button size="sm" className="mt-2 w-full" onClick={requestPermission}>
              Ativar notificações
            </Button>
          </div>
        )}

        {permission === "denied" && (
          <p className="mt-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
            As notificações estão bloqueadas para este site. Libere nas configurações do navegador —
            até lá, os lembretes aparecem aqui e como aviso na tela.
          </p>
        )}

        <div className="mt-3 space-y-1.5">
          {upcoming.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nenhum lembrete agendado. Você pode criar um dentro de qualquer tarefa.
            </p>
          )}
          {upcoming.map((reminder) => (
            <Link
              key={reminder.id}
              to="/tarefas/quadros/$boardId"
              params={{ boardId: reminder.board_id }}
              search={{ task: reminder.task_id }}
              onClick={() => setOpen(false)}
              className="state-bar state-due block rounded-xl border border-border p-2.5 transition-colors hover:bg-accent"
            >
              <p
                className="truncate text-xs font-semibold"
                title={tituloPorExtenso(reminder.task_title)}
              >
                {resumirTitulo(reminder.task_title)}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {reminder.space_name} › {reminder.board_name}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {formatDateTimeBR(reminder.remind_at)}
              </p>
              {reminder.note && (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {reminder.note}
                </p>
              )}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
