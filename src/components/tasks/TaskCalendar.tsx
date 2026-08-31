import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toISODate } from "@/lib/format";
import type { AgendaEvent } from "@/lib/google";
import { useSaveTask, type AccountUser, type Task } from "@/lib/tasks";
import {
  WEEKDAY_LABELS,
  dayKey,
  daysOfRange,
  monthMatrix,
  todayKey,
  weekDays,
} from "@/lib/tasks-analytics";
import { useTone } from "@/hooks/use-tone";
import { buildCalendarEntries, type EntryMeta } from "./calendar-entries";
import { TimeGrid, type GridEntry } from "./TimeGrid";

type Mode = "month" | "week" | "day";

/** Um item da visão mensal, que é uma lista por dia e não uma régua de horas. */
type MonthChip = {
  id: string;
  day: string;
  title: string;
  color: string;
  kind: "task" | "subtask" | "agenda";
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

/** Chips do mês: tarefas em todos os dias que cobrem, subtarefas e compromissos. */
function buildMonthChips(tasks: Task[], agenda: AgendaEvent[]): MonthChip[] {
  const chips: MonthChip[] = [];
  for (const task of tasks) {
    for (const day of daysOfRange(task.start_date, task.due_date)) {
      chips.push({
        id: `${task.id}-${day}`,
        day,
        title: task.title,
        color: task.status?.color ?? task.board.color,
        kind: "task",
        task,
      });
    }
    for (const sub of task.subtasks) {
      const day = dayKey(sub.due_date ?? sub.start_date);
      if (!day) continue;
      chips.push({
        id: `sub-${sub.id}`,
        day,
        title: `↳ ${sub.title}`,
        color: "#94A3B8",
        kind: "subtask",
        task,
      });
    }
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  for (const event of agenda) {
    if (event.taskId && taskIds.has(event.taskId)) continue;
    chips.push({
      id: `agenda-${event.id}`,
      day: localDay(event.start),
      title: event.title,
      color: "var(--color-warning)",
      kind: "agenda",
      ...(event.link ? { link: event.link } : {}),
    });
  }
  return chips;
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
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const tone = useTone();
  const save = useSaveTask();

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

  const days = useMemo(
    () => (mode === "month" ? monthMatrix(anchor) : mode === "week" ? weekDays(anchor) : [anchor]),
    [mode, anchor],
  );

  const from = toISODate(days[0]!);
  const to = toISODate(days[days.length - 1]!);
  useEffect(() => {
    onRangeChange?.({ from, to });
  }, [from, to, onRangeChange]);

  const { entries, meta } = useMemo(() => buildCalendarEntries(tasks, agenda), [tasks, agenda]);

  /** Abrir: tarefa vai para o diálogo, compromisso vai para o Google. */
  const openEntry = useCallback(
    (entry: GridEntry) => {
      if (entry.source === "agenda") {
        if (entry.link) window.open(entry.link, "_blank", "noreferrer");
        return;
      }
      const found = meta.get(entry.id);
      if (found) onOpen(found.task);
    },
    [meta, onOpen],
  );

  /**
   * Grava o que o arraste produziu.
   *
   * `write` decide o que a nova posição significa: num bloco com as duas datas
   * ela é o intervalo inteiro; num bloco que nasceu só do prazo, é o prazo.
   * `saveTask` leva a mudança para a agenda do Google sozinho, quando a tarefa
   * tem compromisso ligado.
   */
  const persist = useCallback(
    async (found: EntryMeta, start: Date, end: Date) => {
      const { task, write } = found;
      const dates =
        write === "both"
          ? { start_date: start.toISOString(), due_date: end.toISOString() }
          : write === "due"
            ? { due_date: start.toISOString() }
            : { start_date: start.toISOString() };

      try {
        await save.mutateAsync({
          id: task.id,
          board_id: task.board_id,
          status_id: task.status_id,
          title: task.title,
          ...dates,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
      }
    },
    [save],
  );

  const handleMove = useCallback(
    (entry: GridEntry, start: Date, end: Date) => {
      const found = meta.get(entry.id);
      if (found) void persist(found, start, end);
    },
    [meta, persist],
  );

  const handleResize = useCallback(
    (entry: GridEntry, end: Date) => {
      const found = meta.get(entry.id);
      if (found) void persist(found, entry.start, end);
    },
    [meta, persist],
  );

  const monthChips = useMemo(
    () => (mode === "month" ? buildMonthChips(tasks, agenda) : []),
    [mode, tasks, agenda],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, MonthChip[]>();
    for (const chip of monthChips) map.set(chip.day, [...(map.get(chip.day) ?? []), chip]);
    return map;
  }, [monthChips]);

  const today = todayKey();

  const chip = (c: MonthChip) =>
    c.kind === "agenda" ? (
      <a
        key={c.id}
        href={c.link ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="group flex w-full items-center gap-1.5 truncate rounded-md border border-dashed border-warning/40 bg-warning-soft px-1.5 py-1 text-left text-[11px] font-medium text-warning-soft-foreground transition-colors hover:border-warning"
        title={`${c.title} · Google Agenda`}
      >
        <CalendarClock className="size-2.5 shrink-0" />
        <span className="truncate">{c.title}</span>
        <ExternalLink className="ml-auto size-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    ) : (
      <button
        key={c.id}
        onClick={() => c.task && onOpen(c.task)}
        className="flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-colors hover:bg-accent"
        title={`${c.title} · ${c.task?.board.name ?? ""}`}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone(c.color) }} />
        <span className={`truncate ${c.kind === "subtask" ? "text-muted-foreground" : ""}`}>
          {c.title}
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
        <div className="flex items-center gap-3">
          {mode !== "month" && (
            <p className="hidden text-[11px] text-muted-foreground lg:block">
              Arraste para mover · puxe a borda de baixo para mudar a duração
            </p>
          )}
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
      </div>

      {mode === "month" ? (
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
              const otherMonth = d.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-28 space-y-0.5 border-b border-r border-border p-1.5 last:border-r-0 ${
                    otherMonth ? "bg-surface/60" : ""
                  }`}
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
                  {items.slice(0, 4).map(chip)}
                  {items.length > 4 && (
                    <p className="px-1 text-[10px] text-muted-foreground">
                      +{items.length - 4} mais
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <TimeGrid
          days={days}
          entries={entries}
          onOpen={openEntry}
          onMove={handleMove}
          onResize={handleResize}
        />
      )}
    </div>
  );
}
