import { parseISODate, toISODate } from "./format";

/**
 * As datas em que uma recorrência cobra.
 *
 * A regra de recorrência sempre foi só projeção: os cartões do mês somavam o
 * valor dela, mas nenhum lançamento existia de verdade. Isso funciona olhando
 * para a frente e falha olhando para trás — quem cadastra em setembro um
 * aluguel que começou em janeiro quer os oito meses no extrato, não uma linha
 * de gráfico. Esta função diz exatamente quais datas são essas, e é ela que a
 * confirmação mostra antes de gravar qualquer coisa.
 */
export type RecurringSchedule = {
  frequency: "monthly" | "weekly" | "yearly";
  /** Dia do mês da cobrança mensal; ignorado nas outras frequências. */
  day_of_month: number;
  start_date: string;
  end_date?: string | null;
};

/**
 * Teto de segurança.
 *
 * Uma data de início digitada errada (1900, por engano) geraria milhares de
 * lançamentos num clique. O limite corta a lista, e quem chama avisa que ela
 * foi cortada em vez de gravar um dilúvio silencioso.
 */
export const MAX_RECURRING_BACKFILL = 240;

/**
 * Até onde a série é criada à frente.
 *
 * "Para sempre" não existe num banco: o que existe é um horizonte que anda
 * sozinho. Dois anos cobrem qualquer projeção que as telas mostram, e a data
 * cai no fim do mês de propósito — assim o horizonte muda uma vez por mês, e
 * não a cada dia, e a rotina que o completa quase sempre não tem o que fazer.
 */
export const RECURRING_HORIZON_MONTHS = 24;

export function recurringHorizon(today: Date = new Date()): string {
  const end = new Date(today.getFullYear(), today.getMonth() + RECURRING_HORIZON_MONTHS + 1, 0);
  return toISODate(end);
}

/** Último dia do mês, para não inventar 31 de fevereiro. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Datas de cobrança de `start_date` até `until`, inclusive nos dois extremos.
 *
 * Nunca devolve data anterior ao início: um mensal que começa dia 20 com
 * cobrança no dia 5 estreia no mês seguinte, não retroage dentro do próprio mês
 * de início.
 */
export function occurrencesUntil(
  rule: RecurringSchedule,
  until: string,
  max: number = MAX_RECURRING_BACKFILL,
): string[] {
  const start = parseISODate(rule.start_date);
  const limit = parseISODate(until);
  const end = rule.end_date ? parseISODate(rule.end_date) : null;
  if (Number.isNaN(start.getTime()) || Number.isNaN(limit.getTime())) return [];

  const stop = end && end < limit ? end : limit;
  if (stop < start) return [];

  const dates: string[] = [];

  if (rule.frequency === "weekly") {
    for (
      const cursor = new Date(start);
      cursor <= stop && dates.length < max;
      cursor.setDate(cursor.getDate() + 7)
    ) {
      dates.push(toISODate(cursor));
    }
    return dates;
  }

  if (rule.frequency === "yearly") {
    for (let year = start.getFullYear(); dates.length < max; year = year + 1) {
      const day = Math.min(start.getDate(), daysInMonth(year, start.getMonth()));
      const occurrence = new Date(year, start.getMonth(), day);
      if (occurrence > stop) break;
      if (occurrence >= start) dates.push(toISODate(occurrence));
    }
    return dates;
  }

  // Mensal: o dia pedido, encurtado ao último dia dos meses mais curtos.
  const wanted = Math.min(31, Math.max(1, Math.trunc(rule.day_of_month) || 1));
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    dates.length < max;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const day = Math.min(wanted, daysInMonth(cursor.getFullYear(), cursor.getMonth()));
    const occurrence = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    if (occurrence > stop) break;
    if (occurrence >= start) dates.push(toISODate(occurrence));
  }
  return dates;
}
