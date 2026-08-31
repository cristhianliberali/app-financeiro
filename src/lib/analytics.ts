import type { Category, Transaction } from "./data";
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
