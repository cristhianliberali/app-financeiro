import { describe, expect, test } from "bun:test";

import {
  MAX_RECURRING_BACKFILL,
  RECURRING_HORIZON_MONTHS,
  occurrencesUntil,
  recurringHorizon,
} from "@/lib/recurring";

describe("occurrencesUntil", () => {
  test("mensal retroativo lista uma cobrança por mês até hoje", () => {
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 5, start_date: "2026-01-05" },
      "2026-09-01",
    );
    expect(dates).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
      "2026-06-05",
      "2026-07-05",
      "2026-08-05",
    ]);
  });

  test("não retroage dentro do próprio mês de início", () => {
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 5, start_date: "2026-01-20" },
      "2026-03-31",
    );
    expect(dates).toEqual(["2026-02-05", "2026-03-05"]);
  });

  test("dia 31 encurta para o último dia dos meses curtos", () => {
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 31, start_date: "2026-01-31" },
      "2026-04-30",
    );
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  test("a data-limite entra na lista", () => {
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 10, start_date: "2026-08-10" },
      "2026-09-10",
    );
    expect(dates).toEqual(["2026-08-10", "2026-09-10"]);
  });

  test("semanal cobra de sete em sete dias a partir do início", () => {
    const dates = occurrencesUntil(
      { frequency: "weekly", day_of_month: 1, start_date: "2026-08-03" },
      "2026-08-25",
    );
    expect(dates).toEqual(["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"]);
  });

  test("anual repete o mesmo dia e mês do início", () => {
    const dates = occurrencesUntil(
      { frequency: "yearly", day_of_month: 1, start_date: "2023-03-15" },
      "2026-09-01",
    );
    expect(dates).toEqual(["2023-03-15", "2024-03-15", "2025-03-15", "2026-03-15"]);
  });

  test("o fim da regra corta antes da data-limite", () => {
    const dates = occurrencesUntil(
      {
        frequency: "monthly",
        day_of_month: 1,
        start_date: "2026-01-01",
        end_date: "2026-03-01",
      },
      "2026-09-01",
    );
    expect(dates).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  test("início no futuro não gera nada para trás", () => {
    expect(
      occurrencesUntil(
        { frequency: "monthly", day_of_month: 5, start_date: "2027-01-05" },
        "2026-09-01",
      ),
    ).toEqual([]);
  });

  test("um início absurdamente antigo para no teto, em vez de gerar milhares", () => {
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 1, start_date: "1900-01-01" },
      "2026-09-01",
    );
    expect(dates).toHaveLength(MAX_RECURRING_BACKFILL);
  });
});

describe("recurringHorizon", () => {
  test("alcança dois anos à frente e para no fim do mês", () => {
    // Fim do mês de propósito: assim o horizonte muda uma vez por mês, e a
    // rotina que completa a série quase sempre não tem o que fazer.
    expect(recurringHorizon(new Date("2026-09-15T12:00:00"))).toBe("2028-09-30");
    expect(recurringHorizon(new Date("2026-01-31T12:00:00"))).toBe("2028-01-31");
  });

  test("qualquer dia do mesmo mês devolve o mesmo horizonte", () => {
    const inicio = recurringHorizon(new Date("2026-09-01T12:00:00"));
    const fim = recurringHorizon(new Date("2026-09-30T12:00:00"));
    expect(inicio).toBe(fim);
  });

  test("a série cobre o horizonte inteiro de uma regra mensal", () => {
    const hoje = new Date("2026-09-15T12:00:00");
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 5, start_date: "2026-09-05" },
      recurringHorizon(hoje),
      600,
    );
    // Do mês de início até o horizonte: 24 meses à frente, mais o corrente.
    expect(dates.length).toBe(RECURRING_HORIZON_MONTHS + 1);
    expect(dates[0]).toBe("2026-09-05");
    expect(dates[dates.length - 1]).toBe("2028-09-05");
  });

  test("completar a partir de onde parou não recria o que já existe", () => {
    // É o que a rotina faz a cada mês: recomeça do `materialized_until`.
    const jaCriadoAte = "2028-09-30";
    const dates = occurrencesUntil(
      { frequency: "monthly", day_of_month: 5, start_date: jaCriadoAte },
      "2028-10-31",
      600,
    );
    expect(dates).toEqual(["2028-10-05"]);
  });
});
