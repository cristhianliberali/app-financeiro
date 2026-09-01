/**
 * As datas nos dois sentidos da sincronização com o Google Agenda.
 *
 * Tarefa e compromisso não são a mesma coisa, e é por isso que a conversão
 * merece um módulo só dela. Uma tarefa pode ter as duas datas, só o prazo, só o
 * início — ou datas sem horário nenhum. Um compromisso sempre tem começo e fim.
 * Ir e voltar entre os dois formatos sem essa tradução explícita faria a tarefa
 * mudar de forma sozinha a cada rodada de sincronização: a que só tinha prazo
 * ganharia um início, a de um dia inteiro viraria uma hora, e assim por diante.
 *
 * A regra é a mesma que a grade de horários do app já usa ao arrastar um bloco
 * (`calendar-entries.ts`): o que tem uma ponta só continua com uma ponta só
 * enquanto a duração do compromisso for a padrão. Esticar o compromisso é que
 * transforma a tarefa num intervalo de verdade.
 *
 * Sem dependência de banco nem de rede de propósito — é lógica de calendário, e
 * ela é conferida por teste.
 */

/** Duração dada ao compromisso de uma tarefa que marca um instante só. */
export const DEFAULT_EVENT_MINUTES = 60;

/** O mínimo do evento do Google que o cálculo de datas lê. */
export type EventTimes = {
  start?: { dateTime?: string | undefined; date?: string | undefined } | undefined;
  end?: { dateTime?: string | undefined; date?: string | undefined } | undefined;
};

export type TaskDates = { start_date: Date | null; due_date: Date | null };

export type EventWindow = { start: Date; end: Date };

/** A janela do compromisso que corresponde às datas da tarefa (app → agenda). */
export function windowFromTask(task: TaskDates): EventWindow | null {
  const anchor = task.start_date ?? task.due_date;
  if (!anchor) return null;

  const start = new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const dueAt = task.due_date ? new Date(task.due_date) : null;
  const end =
    dueAt && !Number.isNaN(dueAt.getTime()) && dueAt.getTime() > start.getTime()
      ? dueAt
      : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);

  return { start, end };
}

/**
 * A janela do compromisso como o Google a descreve (agenda → app).
 *
 * O evento de dia inteiro chega com o fim **exclusivo** — um compromisso de um
 * dia só vai de `2026-09-01` a `2026-09-02`. Tratar esse fim como se fosse
 * inclusivo jogaria o prazo da tarefa um dia para a frente a cada leitura.
 */
export function windowFromEvent(event: EventTimes): EventWindow | null {
  const startTime = event.start?.dateTime;
  if (startTime) {
    const start = new Date(startTime);
    if (Number.isNaN(start.getTime())) return null;

    const endTime = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const end =
      endTime && !Number.isNaN(endTime.getTime()) && endTime.getTime() > start.getTime()
        ? endTime
        : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
    return { start, end };
  }

  const startDate = event.start?.date;
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const endExclusive = event.end?.date ? new Date(`${event.end.date}T00:00:00`) : null;
  const lastDay =
    endExclusive && !Number.isNaN(endExclusive.getTime())
      ? new Date(endExclusive.getTime() - 86_400_000)
      : start;

  const end = new Date(Math.max(lastDay.getTime(), start.getTime()));
  end.setHours(23, 59, 0, 0);
  return { start, end };
}

/** Duas janelas iguais até o minuto — o segundo que o Google devolve não conta. */
function sameWindow(a: EventWindow, b: EventWindow): boolean {
  const minute = (date: Date) => Math.floor(date.getTime() / 60_000);
  return minute(a.start) === minute(b.start) && minute(a.end) === minute(b.end);
}

/**
 * Como ficam as datas da tarefa depois de o compromisso mudar na agenda.
 *
 * Devolve `null` quando não há o que gravar — inclusive no caso mais comum de
 * todos: o evento que a leitura traz é o espelho do que o próprio app acabou de
 * escrever. Sem essa comparação, cada escrita voltaria como se fosse uma edição
 * feita pela pessoa, e as duas pontas ficariam se corrigindo em círculo.
 */
export function taskDatesFromEvent(task: TaskDates, event: EventTimes): TaskDates | null {
  const moved = windowFromEvent(event);
  if (!moved) return null;

  const current = windowFromTask(task);
  if (current && sameWindow(current, moved)) return null;

  // Duração padrão: o compromisso foi movido, não esticado. A tarefa que tinha
  // uma ponta só continua com uma ponta só — arrastar no dia muda o prazo, não
  // inventa um início que a pessoa nunca escreveu.
  const minutes = Math.round((moved.end.getTime() - moved.start.getTime()) / 60_000);
  if (minutes === DEFAULT_EVENT_MINUTES) {
    if (!task.start_date && task.due_date) return { start_date: null, due_date: moved.start };
    if (!task.due_date && task.start_date) return { start_date: moved.start, due_date: null };
  }

  return { start_date: moved.start, due_date: moved.end };
}
