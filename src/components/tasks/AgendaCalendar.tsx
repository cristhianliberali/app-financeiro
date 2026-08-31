import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTone } from "@/hooks/use-tone";
import { useAgendaEvents, useGoogleStatus, useSyncGoogleNow } from "@/lib/google";
import type { Task } from "@/lib/tasks";
import { formatDateBR, toISODate } from "@/lib/format";
import { WEEKDAY_LABELS, monthMatrix, todayKey, weekDays } from "@/lib/tasks-analytics";

/**
 * Calendário do painel: tarefas do app e compromissos da agenda no mesmo lugar.
 *
 * A semana é o padrão porque é a janela em que se trabalha; o mês serve para
 * enxergar carga. Compromisso que nasceu de uma tarefa aparece uma vez só — o
 * evento carrega o id da tarefa, então dá para reconhecer e não duplicar.
 */

type Mode = "week" | "month";

type Entry = {
  id: string;
  day: string;
  at: string | null;
  title: string;
  color: string;
  source: "task" | "agenda";
  task?: Task;
  link?: string | undefined;
};

/** Dia local do timestamp — o usuário pensa no fuso dele, não em UTC. */
function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function hourLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (date.getHours() === 0 && date.getMinutes() === 0) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function shiftDate(base: Date, mode: Mode, direction: number): Date {
  const next = new Date(base);
  if (mode === "week") next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

export function AgendaCalendar({
  tasks,
  onOpenTask,
}: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const tone = useTone();
  const { data: status } = useGoogleStatus();
  const sync = useSyncGoogleNow();

  const [mode, setMode] = useState<Mode>("week");
  const [reference, setReference] = useState(() => new Date());

  // Os dois helpers devolvem `Date`; o calendário trabalha com a chave do dia.
  const days = useMemo(
    () => (mode === "week" ? weekDays(reference) : monthMatrix(reference)).map(toISODate),
    [mode, reference],
  );
  const range = useMemo(
    () => ({ from: days[0] ?? todayKey(), to: days[days.length - 1] ?? todayKey() }),
    [days],
  );

  const { data: agenda = [], isFetching } = useAgendaEvents(status?.connected ? range : null);

  const entries = useMemo(() => {
    const list: Entry[] = [];

    for (const task of tasks) {
      const at = task.due_date ?? task.start_date;
      if (!at) continue;
      list.push({
        id: `task-${task.id}`,
        day: localDay(at),
        at,
        title: task.title,
        color: task.status?.color ?? task.board.color,
        source: "task",
        task,
      });
    }

    const taskIds = new Set(tasks.map((task) => task.id));
    for (const event of agenda) {
      // O compromisso da tarefa já está na lista acima.
      if (event.taskId && taskIds.has(event.taskId)) continue;
      list.push({
        id: `agenda-${event.id}`,
        day: localDay(event.start),
        at: event.start,
        title: event.title,
        color: "#8A8A8A",
        source: "agenda",
        link: event.link,
      });
    }

    return list.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }, [tasks, agenda]);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries) map.set(entry.day, [...(map.get(entry.day) ?? []), entry]);
    return map;
  }, [entries]);

  const title =
    mode === "week" && days.length > 0
      ? `${formatDateBR(days[0]!)} — ${formatDateBR(days[days.length - 1]!)}`
      : reference.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const today = todayKey();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReference((base) => shiftDate(base, mode, -1))}
            aria-label="Período anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReference(new Date())}>
            Hoje
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReference((base) => shiftDate(base, mode, 1))}
            aria-label="Próximo período"
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-medium first-letter:uppercase">{title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-border bg-secondary p-0.5">
            {(
              [
                ["week", "Semana"],
                ["month", "Mês"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  mode === value
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {status?.connected && (
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending || isFetching}
              onClick={async () => {
                const result = await sync.mutateAsync();
                if (result.error) {
                  // O Google recusou: dizer o motivo é melhor do que um
                  // "sincronizada" que não sincronizou nada.
                  toast.error(`O Google recusou: ${result.error}`, { duration: 15000 });
                  return;
                }
                const notas = [
                  result.pushed > 0 ? `${result.pushed} tarefa(s) enviadas` : null,
                  result.cleared > 0 ? `${result.cleared} com as datas limpas` : null,
                ].filter(Boolean);
                toast.success(
                  notas.length > 0
                    ? `Agenda sincronizada · ${notas.join(" · ")}`
                    : "Agenda sincronizada",
                );
              }}
            >
              <RefreshCw className={`mr-1 size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
              Sincronizar agora
            </Button>
          )}
        </div>
      </div>

      {status && !status.connected && (
        <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
          {status.configured
            ? "Conecte o Google Agenda no seu perfil para ver os compromissos aqui junto das tarefas."
            : "A integração com o Google Agenda não está configurada neste servidor."}
        </p>
      )}

      {status?.connected && status.lastError && (
        <p className="rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs text-foreground">
          <span className="font-semibold">A última conversa com o Google falhou:</span>{" "}
          {status.lastError}
        </p>
      )}

      <div
        className={`grid gap-2 ${mode === "week" ? "sm:grid-cols-7" : "grid-cols-7"}`}
        role="grid"
      >
        {mode === "month" &&
          WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center text-[11px] uppercase text-muted-foreground">
              {label}
            </div>
          ))}

        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`min-h-24 rounded-xl border p-2 transition-colors ${
                isToday ? "border-primary bg-primary-soft ring-1 ring-primary/20" : "border-border"
              } ${mode === "month" ? "min-h-20" : ""}`}
            >
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                {mode === "week" && `${WEEKDAY_LABELS[new Date(`${day}T12:00:00`).getDay()]} `}
                {Number(day.slice(8, 10))}
              </p>

              <div className="space-y-1">
                {items.slice(0, mode === "week" ? 8 : 4).map((entry) =>
                  entry.source === "task" ? (
                    <button
                      key={entry.id}
                      onClick={() => entry.task && onOpenTask(entry.task)}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-colors hover:bg-accent"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: tone(entry.color) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {hourLabel(entry.at)}
                      </span>
                    </button>
                  ) : (
                    <a
                      key={entry.id}
                      href={entry.link ?? "#"}
                      target={entry.link ? "_blank" : undefined}
                      rel="noreferrer"
                      className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-1.5 py-1 text-[11px] transition-colors hover:bg-accent"
                      title="Compromisso da agenda"
                    >
                      <CalendarClock className="size-3 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {entry.link && <ExternalLink className="size-2.5 shrink-0 opacity-60" />}
                    </a>
                  ),
                )}
                {items.length > (mode === "week" ? 8 : 4) && (
                  <p className="px-1 text-[10px] text-muted-foreground">
                    +{items.length - (mode === "week" ? 8 : 4)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
