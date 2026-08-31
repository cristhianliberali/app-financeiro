import type { AgendaEvent } from "@/lib/google";
import type { Task } from "@/lib/tasks";
import type { GridEntry } from "./TimeGrid";

/**
 * Traduz tarefas e compromissos para os blocos da grade de horários.
 *
 * A tradução não é óbvia porque uma tarefa não é um compromisso: ela pode ter
 * as duas datas, só o prazo, só o início, ou datas sem horário nenhum. Cada
 * caso vira um bloco diferente — e, mais importante, muda o que arrastar
 * significa. Um bloco que nasceu só do prazo não tem duração de verdade: o que
 * o arraste move ali é o prazo, e esticar não faria sentido, então ele não
 * estica. `write` é o que guarda essa decisão para o outro lado.
 */
export type EntryMeta = {
  task: Task;
  /** Qual data o arraste grava. */
  write: "both" | "due" | "start";
};

/** Duração dada a uma tarefa que só marca um instante (prazo ou início). */
const DEFAULT_MINUTES = 60;

const hasTime = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const plusMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

/** Dias cobertos por um intervalo, para a faixa "sem hora". */
function daysBetween(start: Date, end: Date, max = 31): Date[] {
  const out: Date[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(end);
  limit.setHours(0, 0, 0, 0);
  while (cursor <= limit && out.length < max) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function buildCalendarEntries(
  tasks: Task[],
  agenda: AgendaEvent[],
): { entries: GridEntry[]; meta: Map<string, EntryMeta> } {
  const entries: GridEntry[] = [];
  const meta = new Map<string, EntryMeta>();

  for (const task of tasks) {
    const start = task.start_date ? new Date(task.start_date) : null;
    const due = task.due_date ? new Date(task.due_date) : null;
    if (!start && !due) continue;

    const color = task.status?.color ?? task.board.color;
    const done = task.status?.polarity === "SUCCESS";
    const subtitle = `${task.space.name} › ${task.board.name}`;
    const base = {
      title: task.title,
      color,
      source: "task" as const,
      done,
      subtitle,
    };

    // Intervalo com as duas pontas: o bloco é o intervalo, e estica pelo prazo.
    if (
      start &&
      due &&
      sameDay(start, due) &&
      due > start &&
      (hasTime(task.start_date!) || hasTime(task.due_date!))
    ) {
      const id = `task-${task.id}`;
      entries.push({ ...base, id, start, end: due, allDay: false, canMove: true, canResize: true });
      meta.set(id, { task, write: "both" });
      continue;
    }

    // Duas pontas em dias diferentes: vira faixa "sem hora" em cada dia.
    if (start && due && !sameDay(start, due)) {
      for (const day of daysBetween(start, due)) {
        const id = `task-${task.id}-${day.toISOString().slice(0, 10)}`;
        entries.push({
          ...base,
          id,
          start: day,
          end: day,
          allDay: true,
          canMove: false,
          canResize: false,
        });
        meta.set(id, { task, write: "both" });
      }
      continue;
    }

    // Uma ponta só. Com horário, ganha um bloco de uma hora a partir dela;
    // sem horário, não há o que desenhar na régua e ela vai para o topo.
    const anchor = due ?? start!;
    const anchorIso = (due ? task.due_date : task.start_date)!;
    const id = `task-${task.id}`;
    const write: EntryMeta["write"] = due ? "due" : "start";

    if (hasTime(anchorIso)) {
      entries.push({
        ...base,
        id,
        start: anchor,
        end: plusMinutes(anchor, DEFAULT_MINUTES),
        allDay: false,
        canMove: true,
        canResize: false,
      });
    } else {
      entries.push({
        ...base,
        id,
        start: anchor,
        end: anchor,
        allDay: true,
        canMove: false,
        canResize: false,
      });
    }
    meta.set(id, { task, write });
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  for (const event of agenda) {
    // O compromisso que nasceu de uma tarefa já está na lista como tarefa.
    if (event.taskId && taskIds.has(event.taskId)) continue;
    const start = new Date(event.start);
    const end = new Date(event.end);
    const timed = hasTime(event.start) || end.getTime() - start.getTime() < 20 * 3600_000;

    entries.push({
      id: `agenda-${event.id}`,
      title: event.title,
      color: "var(--color-warning)",
      source: "agenda",
      start,
      end: end > start ? end : plusMinutes(start, DEFAULT_MINUTES),
      allDay: !timed,
      canMove: false,
      canResize: false,
      subtitle: "Google Agenda",
      ...(event.link ? { link: event.link } : {}),
    });
  }

  return { entries, meta };
}
