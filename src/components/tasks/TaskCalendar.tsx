import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toISODate } from "@/lib/format";
import type { AgendaEvent } from "@/lib/google";
import type { AccountUser, Task } from "@/lib/tasks";
import {
  WEEKDAY_LABELS,
  dayKey,
  daysOfRange,
  monthMatrix,
  todayKey,
  weekDays,
} from "@/lib/tasks-analytics";
import { useTone } from "@/hooks/use-tone";

type Mode = "month" | "week" | "day";

/** Dia local do timestamp — o usuário pensa no fuso dele, não em UTC. */
function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Um item do calendário.
 *
 * Tarefa e subtarefa abrem o diálogo da tarefa; compromisso da agenda abre o
 * evento no Google, porque ele não existe aqui dentro para ser editado — daí
 * `task` ser opcional e `link` só existir no compromisso.
 */
type CalendarEvent = {
  id: string;
  day: string;
  title: string;
  color: string;
  kind: "task" | "subtask" | "agenda";
  task?: Task;
  at?: string | null;
  link?: string | undefined;
};

/** Constrói os eventos do calendário: tarefas com datas e subtarefas datadas. */
function buildEvents(tasks: Task[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const task of tasks) {
    const days = daysOfRange(task.start_date, task.due_date);
    for (const day of days) {
      events.push({
        id: `${task.id}-${day}`,
        day,
        title: task.title,
        color: task.status?.color ?? task.board.color,
        kind: "task",
        task,
      });
    }
    // Subtarefas aparecem no calendário quando possuem data definida.
    for (const sub of task.subtasks) {
      const day = dayKey(sub.due_date ?? sub.start_date);
      if (!day) continue;
      events.push({
        id: `sub-${sub.id}`,
        day,
        title: `↳ ${sub.title}`,
        color: "#94A3B8",
        kind: "subtask",
        task,
      });
    }
  }
  return events;
}

export function TaskCalendar({
  tasks,
  agenda = [],
  onOpen,
  onRangeChange,
}: {
  tasks: Task[];
  users?: AccountUser[];
  /** Compromissos do Google já filtrados pela janela visível. */
  agenda?: AgendaEvent[];
  onOpen: (task: Task) => void;
  /** Avisa a tela qual janela está aberta, para ela buscar a agenda certa. */
  onRangeChange?: (range: { from: string; to: string }) => void;
}) {
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const events = useMemo(() => {
    const list = buildEvents(tasks);
    const taskIds = new Set(tasks.map((task) => task.id));

    for (const event of agenda) {
      // O compromisso que nasceu de uma tarefa já está na lista como tarefa.
      if (event.taskId && taskIds.has(event.taskId)) continue;
      list.push({
        id: `agenda-${event.id}`,
        day: localDay(event.start),
        title: event.title,
        color: "var(--color-warning)",
        kind: "agenda",
        at: event.start,
        link: event.link,
      });
    }

    return list;
  }, [tasks, agenda]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) map.set(e.day, [...(map.get(e.day) ?? []), e]);
    return map;
  }, [events]);

  const step = (dir: number) => {
    const next = new Date(anchor);
    if (mode === "month") next.setMonth(anchor.getMonth() + dir);
    else if (mode === "week") next.setDate(anchor.getDate() + dir * 7);
    else next.setDate(anchor.getDate() + dir);
    setAnchor(next);
  };

  const title =
    mode === "day"
      ? anchor.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
      : anchor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const days =
    mode === "month" ? monthMatrix(anchor) : mode === "week" ? weekDays(anchor) : [anchor];
  const today = todayKey();
  const tone = useTone();

  // A janela visível define quais compromissos buscar; ela muda ao trocar de
  // modo e ao andar no tempo, então é reportada em vez de recalculada lá fora.
  const from = toISODate(days[0]!);
  const to = toISODate(days[days.length - 1]!);
  useEffect(() => {
    onRangeChange?.({ from, to });
  }, [from, to, onRangeChange]);

  const eventChip = (e: CalendarEvent) =>
    e.kind === "agenda" ? (
      <a
        key={e.id}
        href={e.link ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="group flex w-full items-center gap-1.5 truncate rounded-md border border-dashed border-warning/40 bg-warning-soft px-1.5 py-1 text-left text-[11px] font-medium text-warning-soft-foreground transition-colors hover:border-warning"
        title={`${e.title} · Google Agenda`}
      >
        <CalendarClock className="size-2.5 shrink-0" />
        <span className="truncate">{e.title}</span>
        <ExternalLink className="ml-auto size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    ) : (
      <button
        key={e.id}
        onClick={() => e.task && onOpen(e.task)}
        className="flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-colors hover:bg-accent"
        title={`${e.title} · ${e.task?.board.name ?? ""}`}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone(e.color) }} />
        <span className={`truncate ${e.kind === "subtask" ? "text-muted-foreground" : ""}`}>
          {e.title}
        </span>
      </button>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Próximo">
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-semibold first-letter:uppercase">{title}</span>
        </div>
        <div className="flex rounded-xl border border-border bg-secondary p-0.5">
          {(
            [
              ["month", "Mensal"],
              ["week", "Semanal"],
              ["day", "Diária"],
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
      </div>

      {mode === "day" ? (
        <div className="panel p-4">
          <p className="mb-3 text-sm font-semibold capitalize">
            {anchor.toLocaleDateString("pt-BR", { weekday: "long" })}
          </p>
          <div className="space-y-1">
            {(byDay.get(toISODate(anchor)) ?? []).map(eventChip)}
            {(byDay.get(toISODate(anchor)) ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nada marcado neste dia.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface text-center">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="label-caps py-2.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = toISODate(d);
              const items = byDay.get(key) ?? [];
              const otherMonth = mode === "month" && d.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-24 space-y-0.5 border-b border-r border-border p-1.5 last:border-r-0 ${
                    otherMonth ? "bg-surface/60" : ""
                  } ${mode === "week" ? "min-h-56" : ""}`}
                >
                  <p
                    className={`mb-1 text-[11px] ${
                      key === today
                        ? "inline-flex size-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground shadow-glow"
                        : otherMonth
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground"
                    }`}
                  >
                    {d.getDate()}
                  </p>
                  {items.slice(0, mode === "week" ? 12 : 4).map(eventChip)}
                  {items.length > (mode === "week" ? 12 : 4) && (
                    <p className="px-1 text-[10px] text-muted-foreground">
                      +{items.length - (mode === "week" ? 12 : 4)} mais
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
