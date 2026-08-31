import type { Category, RecurringRule, Transaction } from "./data";
import { daysBetween, parseISODate } from "./format";
import type { DateBasis } from "./app-state";

export type Totals = { income: number; expense: number; balance: number };

export function totals(txs: Transaction[]): Totals {
  const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount, 0);
  return { income, expense, balance: income - expense };
}

export function byCategory(txs: Transaction[], categories: Category[], kind: "income" | "expense") {
  const map = new Map<string, number>();
  for (const t of txs.filter((t) => t.kind === kind)) {
    const key = t.category_id ?? "none";
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([id, value]) => {
      const cat = categories.find((c) => c.id === id);
      return {
        id,
        // Só o nome: a marca da categoria virou ícone, e o gráfico mostra a
        // categoria pela cor da fatia, não por um desenho na legenda.
        name: cat?.name ?? "Sem categoria",
        color: cat?.color ?? "#94A3B8",
        value,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function monthlySeries(txs: Transaction[], basis: DateBasis) {
  const map = new Map<string, { month: string; receitas: number; despesas: number }>();
  for (const t of txs) {
    const key = t[basis].slice(0, 7);
    const entry = map.get(key) ?? { month: key, receitas: 0, despesas: 0 };
    if (t.kind === "income") entry.receitas += t.amount;
    else entry.despesas += t.amount;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function balanceEvolution(txs: Transaction[], basis: DateBasis) {
  const series = monthlySeries(txs, basis);
  let acc = 0;
  return series.map((s) => {
    acc += s.receitas - s.despesas;
    return { month: s.month, saldo: acc };
  });
}

/**
 * Teto por categoria proporcional ao período selecionado:
 * o teto mensal é convertido em teto diário e multiplicado pelos dias do intervalo.
 *
 * Categoria arquivada fica de fora: o teto é planejamento do que ainda vai ser
 * gasto, e ela não recebe lançamento novo. O que já foi gasto nela continua
 * aparecendo nos gráficos por categoria.
 */
export function categoryBudgets(
  txs: Transaction[],
  categories: Category[],
  from: string,
  to: string,
) {
  const days = daysBetween(from, to);
  const ref = parseISODate(from);
  const daysInMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();

  return categories
    .filter(
      (c) => !c.archived_at && c.kind === "expense" && c.monthly_cap != null && c.monthly_cap > 0,
    )
    .map((c) => {
      const spent = txs
        .filter((t) => t.kind === "expense" && t.category_id === c.id)
        .reduce((s, t) => s + t.amount, 0);
      const cap = (Number(c.monthly_cap) / daysInMonth) * days;
      return {
        category: c,
        spent,
        cap,
        days,
        perDay: Number(c.monthly_cap) / daysInMonth,
        remaining: cap - spent,
        pct: cap > 0 ? Math.min(200, (spent / cap) * 100) : 0,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

// ---------------------------------------------------------------------------
// Linha do tempo de meses
// ---------------------------------------------------------------------------

/**
 * Métricas que a linha do tempo do painel sabe somar mês a mês.
 *
 * `fixed_expense` e `fixed_income` não saem dos lançamentos: eles vêm das
 * regras de recorrência, que são o que o app entende por "fixo". Um lançamento
 * não guarda de qual regra nasceu, então somá-los daria o total do mês, não o
 * compromisso fixo — a regra é a fonte certa.
 */
export type MonthMetric =
  "balance" | "income_expense" | "expense" | "fixed_expense" | "income" | "fixed_income";

export const MONTH_METRICS: Array<{ value: MonthMetric; label: string }> = [
  { value: "balance", label: "Saldo previsto" },
  { value: "income_expense", label: "Despesas e receitas" },
  { value: "expense", label: "Despesas" },
  { value: "fixed_expense", label: "Despesas fixas" },
  { value: "income", label: "Receitas" },
  { value: "fixed_income", label: "Receitas fixas" },
];

export type MonthPoint = {
  /** Chave `YYYY-MM`. */
  key: string;
  income: number;
  expense: number;
  /** O número que a métrica escolhida mostra no cartão do mês. */
  value: number;
};

/** A regra de recorrência vale neste mês? */
function ruleAppliesTo(rule: RecurringRule, monthKey: string): boolean {
  if (!rule.active) return false;
  if (rule.start_date.slice(0, 7) > monthKey) return false;
  if (rule.end_date && rule.end_date.slice(0, 7) < monthKey) return false;
  // Anual só conta no mês em que começou; mensal e semanal caem todo mês.
  return rule.frequency !== "yearly" || rule.start_date.slice(5, 7) === monthKey.slice(5, 7);
}

/** Quantas vezes a regra cobra dentro de um mês. */
function ruleTimesPerMonth(rule: RecurringRule, monthKey: string): number {
  if (rule.frequency !== "weekly") return 1;
  const [year, month] = monthKey.split("-").map(Number);
  return Math.floor(new Date(year!, month ?? 1, 0).getDate() / 7);
}

/**
 * Totais mês a mês para a faixa de meses da linha do tempo.
 *
 * Recebe os lançamentos de toda a janela de uma vez e os distribui pela chave
 * do mês — uma consulta só, em vez de uma por mês.
 */
export function monthTimeline(
  months: string[],
  txs: Transaction[],
  rules: RecurringRule[],
  basis: DateBasis,
  metric: MonthMetric,
): MonthPoint[] {
  const buckets = new Map<string, { income: number; expense: number }>();
  for (const month of months) buckets.set(month, { income: 0, expense: 0 });

  for (const tx of txs) {
    const bucket = buckets.get(tx[basis].slice(0, 7));
    if (!bucket) continue;
    if (tx.kind === "income") bucket.income += tx.amount;
    else bucket.expense += tx.amount;
  }

  return months.map((key) => {
    const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
    const fixed = (kind: "income" | "expense") =>
      rules
        .filter((rule) => rule.kind === kind && ruleAppliesTo(rule, key))
        .reduce((sum, rule) => sum + rule.amount * ruleTimesPerMonth(rule, key), 0);

    const value =
      metric === "balance"
        ? bucket.income - bucket.expense
        : metric === "income_expense"
          ? bucket.income - bucket.expense
          : metric === "expense"
            ? bucket.expense
            : metric === "income"
              ? bucket.income
              : metric === "fixed_expense"
                ? fixed("expense")
                : fixed("income");

    return { key, income: bucket.income, expense: bucket.expense, value };
  });
}

/**
 * Quebra os totais do período por situação: o que já aconteceu e o que ainda
 * está por acontecer. É a leitura dos cartões do topo do painel — saldo
 * disponível é só o que foi pago/recebido; saldo previsto conta tudo.
 */
export function settlement(txs: Transaction[]) {
  const sum = (kind: "income" | "expense", status?: "paid" | "pending") =>
    txs
      .filter((t) => t.kind === kind && (!status || t.status === status))
      .reduce((s, t) => s + t.amount, 0);

  const received = sum("income", "paid");
  const toReceive = sum("income", "pending");
  const paid = sum("expense", "paid");
  const toPay = sum("expense", "pending");

  return {
    income: received + toReceive,
    received,
    toReceive,
    expense: paid + toPay,
    paid,
    toPay,
    /** Já liquidado: entrou menos saiu de fato. */
    available: received - paid,
    /** Com tudo o que está agendado no período. */
    projected: received + toReceive - paid - toPay,
  };
}
