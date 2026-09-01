import { describe, expect, test } from "bun:test";

import {
  DEFAULT_EVENT_MINUTES,
  taskDatesFromEvent,
  windowFromEvent,
  windowFromTask,
} from "@/integrations/google/event-dates";

/** Data local, no fuso da máquina — é assim que o app lê o que vem do banco. */
const at = (iso: string) => new Date(iso);

const timed = (start: string, end: string) => ({
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(end).toISOString() },
});

describe("windowFromTask", () => {
  test("as duas datas viram a janela do compromisso", () => {
    const window = windowFromTask({
      start_date: at("2026-09-10T09:00:00"),
      due_date: at("2026-09-10T11:30:00"),
    });
    expect(window?.start).toEqual(at("2026-09-10T09:00:00"));
    expect(window?.end).toEqual(at("2026-09-10T11:30:00"));
  });

  test("só o prazo vira uma hora a partir dele", () => {
    const window = windowFromTask({ start_date: null, due_date: at("2026-09-10T14:00:00") });
    expect(window?.start).toEqual(at("2026-09-10T14:00:00"));
    expect(window?.end).toEqual(at("2026-09-10T15:00:00"));
  });

  test("tarefa sem data nenhuma não tem compromisso", () => {
    expect(windowFromTask({ start_date: null, due_date: null })).toBeNull();
  });
});

describe("windowFromEvent", () => {
  test("evento com horário devolve começo e fim", () => {
    const window = windowFromEvent(timed("2026-09-10T09:00:00", "2026-09-10T10:30:00"));
    expect(window?.start).toEqual(at("2026-09-10T09:00:00"));
    expect(window?.end).toEqual(at("2026-09-10T10:30:00"));
  });

  test("evento de um dia inteiro fecha no próprio dia, não no seguinte", () => {
    // O Google manda o fim exclusivo: 01 a 02 é um dia só.
    const window = windowFromEvent({ start: { date: "2026-09-01" }, end: { date: "2026-09-02" } });
    expect(window?.start).toEqual(at("2026-09-01T00:00:00"));
    expect(window?.end).toEqual(at("2026-09-01T23:59:00"));
  });

  test("dia inteiro de vários dias termina no último deles", () => {
    const window = windowFromEvent({ start: { date: "2026-09-01" }, end: { date: "2026-09-04" } });
    expect(window?.end).toEqual(at("2026-09-03T23:59:00"));
  });

  test("fim ausente ou anterior ao começo vira a duração padrão", () => {
    const window = windowFromEvent({
      start: { dateTime: at("2026-09-10T08:00:00").toISOString() },
    });
    expect(window?.end).toEqual(at("2026-09-10T09:00:00"));
  });

  test("evento sem data alguma não diz nada", () => {
    expect(windowFromEvent({})).toBeNull();
  });
});

describe("taskDatesFromEvent", () => {
  test("o eco da própria escrita do app não é uma mudança", () => {
    const task = { start_date: at("2026-09-10T09:00:00"), due_date: at("2026-09-10T11:00:00") };
    expect(
      taskDatesFromEvent(task, timed("2026-09-10T09:00:00", "2026-09-10T11:00:00")),
    ).toBeNull();
  });

  test("o eco de uma tarefa que só tem prazo também não é mudança", () => {
    const task = { start_date: null, due_date: at("2026-09-10T14:00:00") };
    // É o compromisso que o app criou: prazo + a hora padrão.
    expect(
      taskDatesFromEvent(task, timed("2026-09-10T14:00:00", "2026-09-10T15:00:00")),
    ).toBeNull();
  });

  test("segundos a mais na resposta do Google não contam como mudança", () => {
    const task = { start_date: at("2026-09-10T09:00:00"), due_date: at("2026-09-10T11:00:00") };
    expect(
      taskDatesFromEvent(task, timed("2026-09-10T09:00:42", "2026-09-10T11:00:17")),
    ).toBeNull();
  });

  test("compromisso movido com a mesma duração move o prazo, sem inventar início", () => {
    const task = { start_date: null, due_date: at("2026-09-10T14:00:00") };
    const next = taskDatesFromEvent(task, timed("2026-09-11T16:00:00", "2026-09-11T17:00:00"));
    expect(next).toEqual({ start_date: null, due_date: at("2026-09-11T16:00:00") });
  });

  test("tarefa que só tinha início continua só com início", () => {
    const task = { start_date: at("2026-09-10T09:00:00"), due_date: null };
    const next = taskDatesFromEvent(task, timed("2026-09-10T13:00:00", "2026-09-10T14:00:00"));
    expect(next).toEqual({ start_date: at("2026-09-10T13:00:00"), due_date: null });
  });

  test("compromisso esticado transforma a tarefa num intervalo de verdade", () => {
    const task = { start_date: null, due_date: at("2026-09-10T14:00:00") };
    const next = taskDatesFromEvent(task, timed("2026-09-10T14:00:00", "2026-09-10T17:30:00"));
    expect(next).toEqual({
      start_date: at("2026-09-10T14:00:00"),
      due_date: at("2026-09-10T17:30:00"),
    });
  });

  test("intervalo movido na agenda move as duas pontas da tarefa", () => {
    const task = { start_date: at("2026-09-10T09:00:00"), due_date: at("2026-09-10T11:00:00") };
    const next = taskDatesFromEvent(task, timed("2026-09-15T13:00:00", "2026-09-15T15:00:00"));
    expect(next).toEqual({
      start_date: at("2026-09-15T13:00:00"),
      due_date: at("2026-09-15T15:00:00"),
    });
  });

  test("virar dia inteiro na agenda cobre o dia inteiro na tarefa", () => {
    const task = { start_date: null, due_date: at("2026-09-10T14:00:00") };
    const next = taskDatesFromEvent(task, {
      start: { date: "2026-09-12" },
      end: { date: "2026-09-13" },
    });
    expect(next).toEqual({
      start_date: at("2026-09-12T00:00:00"),
      due_date: at("2026-09-12T23:59:00"),
    });
  });

  test("aplicar a mudança e reler não muda nada de novo", () => {
    // A garantia contra o vaivém: o que gravamos, relido, é o mesmo.
    const task = { start_date: null, due_date: at("2026-09-10T14:00:00") };
    const next = taskDatesFromEvent(task, timed("2026-09-11T16:00:00", "2026-09-11T17:00:00"))!;
    const window = windowFromTask(next)!;
    expect(
      taskDatesFromEvent(next, {
        start: { dateTime: window.start.toISOString() },
        end: { dateTime: window.end.toISOString() },
      }),
    ).toBeNull();
  });

  test("a duração padrão é a mesma dos dois lados", () => {
    const window = windowFromTask({ start_date: null, due_date: at("2026-09-10T14:00:00") })!;
    expect((window.end.getTime() - window.start.getTime()) / 60_000).toBe(DEFAULT_EVENT_MINUTES);
  });
});
