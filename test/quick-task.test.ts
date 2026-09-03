import { describe, expect, test } from "bun:test";

import { dueFromDay } from "@/lib/tasks-analytics";

/**
 * O prazo do atalho é um dia, sem hora. Traduzi-lo para o timestamp que o banco
 * guarda é onde mora a armadilha: `new Date("2026-09-10")` é meia-noite em UTC,
 * que no Brasil é 21h do dia 9 — a tarefa nasceria vencendo um dia antes.
 */
describe("dueFromDay", () => {
  test("o prazo cai no dia escolhido, não no anterior", () => {
    const iso = dueFromDay("2026-09-10")!;
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(10);
  });

  test("vence no fim do dia, não no começo", () => {
    const d = new Date(dueFromDay("2026-09-10")!);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  test("dia 1º de janeiro não escorrega para o ano anterior", () => {
    const d = new Date(dueFromDay("2026-01-01")!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  test("sem data escolhida, sem prazo", () => {
    expect(dueFromDay("")).toBeNull();
    expect(dueFromDay("2026-09")).toBeNull();
  });
});
