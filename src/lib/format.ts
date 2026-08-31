export const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

export const brlCompact = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

export const toISODate = (d: Date) => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

export const parseISODate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};

export const formatDateBR = (s: string) =>
  parseISODate(s).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
};

export const daysBetween = (a: string, b: string) =>
  Math.max(1, Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000) + 1);

export const daysInMonthOf = (iso: string) => {
  const d = parseISODate(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

/** Chave `YYYY-MM` do mês a que a data pertence. */
export const monthKeyOf = (iso: string) => iso.slice(0, 7);

/** Primeiro e último dia do mês da chave `YYYY-MM`. */
export function monthRange(key: string): { from: string; to: string } {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(year!, (month ?? 1) - 1, 1);
  const last = new Date(year!, month ?? 1, 0);
  return { from: toISODate(first), to: toISODate(last) };
}

/** `2026-08` -> `agosto de 2026`. O ano só aparece quando não é o corrente. */
export function monthTitle(key: string, withYear = true): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, 1);
  const name = date.toLocaleDateString("pt-BR", { month: "long" });
  return withYear ? `${name} de ${year}` : name;
}

/** `2026-08` -> `Agosto`, ou `Agosto '27` quando cai fora do ano corrente. */
export function monthChipLabel(key: string, currentYear: number): string {
  const [year, month] = key.split("-").map(Number);
  const name = new Date(year!, (month ?? 1) - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return year === currentYear ? capitalized : `${capitalized} '${String(year).slice(2)}`;
}

/** Soma (ou subtrai) meses de uma chave `YYYY-MM`. */
export function shiftMonthKey(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * O intervalo cobre exatamente um mês inteiro?
 *
 * É o que decide se a barra de período mostra "Agosto de 2026" e habilita as
 * setas de mês, ou se mostra o intervalo cru porque o recorte é outro.
 */
export function wholeMonthOf(from: string, to: string): string | null {
  if (monthKeyOf(from) !== monthKeyOf(to)) return null;
  const month = monthRange(monthKeyOf(from));
  return month.from === from && month.to === to ? monthKeyOf(from) : null;
}
