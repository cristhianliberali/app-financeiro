/**
 * Leitura de valores monetários no texto do documento.
 *
 * Serve a duas conferências que o servidor faz sobre a resposta da IA: se o
 * valor devolvido existe mesmo no documento, e quais linhas do documento não
 * viraram lançamento nenhum.
 *
 * As duas convenções convivem em faturas brasileiras — "1.234,56" (padrão do
 * país) e "1,234.56" (como o Sicoob imprime) —, então o separador decimal é
 * decidido linha a linha, pelo último separador seguido de exatamente dois
 * dígitos. Chutar uma convenção fixa erraria todo valor acima de mil.
 */

/** Número com centavos, com ou sem separador de milhar, com ou sem "R$". */
const AMOUNT = /-?\s*(?:R\$\s*)?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?![\d.,])/g;

/** "1.234,56" e "1,234.56" viram 1234.56; devolve `null` no que não for valor. */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return null;

  // O último separador é o decimal — é o que separa os centavos.
  const lastSeparator = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  if (lastSeparator === -1) return null;

  const whole = digits.slice(0, lastSeparator).replace(/[.,]/g, "");
  const cents = digits.slice(lastSeparator + 1);
  if (cents.length !== 2) return null;

  const value = Number(`${whole || "0"}.${cents}`);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

/** Todos os valores de uma linha, na ordem em que aparecem. */
export function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT)]
    .map((match) => parseAmount(match[0]))
    .filter((value): value is number => value !== null && value > 0);
}

/**
 * Formas em que um mesmo valor pode aparecer no documento: 1234.56 pode estar
 * escrito como "1.234,56", "1234,56", "1,234.56" ou "1234.56".
 */
export function amountVariants(amount: number): string[] {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split(".") as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return [
    `${whole},${cents}`,
    `${whole}.${cents}`,
    `${grouped.replace(/ /g, ".")},${cents}`,
    `${grouped.replace(/ /g, ",")}.${cents}`,
  ];
}

/** O valor extraído aparece mesmo no documento? */
export function amountAppearsIn(text: string, amount: number): boolean {
  return amountVariants(amount).some((variant) => text.includes(variant));
}
