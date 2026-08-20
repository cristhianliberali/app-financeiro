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
  parseISODate(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

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
