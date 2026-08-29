import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toISODate } from "@/lib/format";
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

type CalendarEvent = {
  id: string;
  day: string;
  title: string;
  color: string;
  kind: "task" | "subtask";
  task: Task;
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
        color: "#8A8A8A",
        kind: "subtask",
        task,
      });
    }
  }
  return events;
}

export function TaskCalendar({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  users?: AccountUser[];
  onOpen: (task: Task) => void;
}) {
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  const events = useMemo(() => buildEvents(tasks), [tasks]);
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

  const eventChip = (e: CalendarEvent) => (
    <button
      key={e.id}
      onClick={() => onOpen(e.task)}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-secondary"
      title={`${e.title} · ${e.task.board.name}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full ring-1 ring-border"
        style={{ backgroundColor: tone(e.color) }}
      />
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
          <span className="ml-2 text-sm font-semibold capitalize">{title}</span>
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
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
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                mode === value
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "day" ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-sm font-semibold capitalize">
            {anchor.toLocaleDateString("pt-BR", { weekday: "long" })}
          </p>
          <div className="space-y-1">
            {(byDay.get(toISODate(anchor)) ?? []).map(eventChip)}
            {(byDay.get(toISODate(anchor)) ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma tarefa neste dia.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] uppercase tracking-wider text-muted-foreground">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-2">
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
                    otherMonth ? "bg-secondary/20" : ""
                  } ${mode === "week" ? "min-h-56" : ""}`}
                >
                  <p
                    className={`mb-1 text-[11px] ${
                      key === today
                        ? "inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
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
