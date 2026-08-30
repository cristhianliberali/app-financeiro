/**
 * Conferência de cobertura: quais linhas do documento não viraram lançamento.
 *
 * Modelos de linguagem transcrevem mal listas longas — numa fatura com uma
 * centena de compras, algumas linhas simplesmente não aparecem na resposta, sem
 * erro nenhum. Como o documento está aqui no servidor, dá para conferir: toda
 * linha que parece lançamento (tem data e valor) precisa ter um valor
 * correspondente entre os lançamentos devolvidos. O que sobrar volta para o
 * modelo numa segunda passada, com só essas linhas.
 *
 * A comparação é por valor, e não por descrição: o valor é o que o modelo copia
 * literalmente, enquanto a descrição ele normaliza ("MERCADOLIVRE*LATICKI" vira
 * "Mercado Livre"). E é uma contagem, não um conjunto — duas compras do mesmo
 * valor no mesmo documento precisam de dois lançamentos.
 */
import { amountsIn } from "./amounts.server";

/** Começo de lançamento: "01 DEZ", "01/12", "01/12/2026", "2026-01-12". */
const DATE_START =
  /^\s*(?:\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?|\d{1,2}\s+[A-Za-zÀ-ÿ]{3,}|\d{4}-\d{2}-\d{2})\b/;

export type EntryLine = {
  /** Índice da linha dentro do lote. */
  index: number;
  /** A linha, junto da anterior quando a descrição foi quebrada em duas. */
  text: string;
  amounts: number[];
};

/**
 * Linhas que parecem lançamento: têm valor e começam com data — ou continuam
 * uma linha de data que ficou sem valor, que é como o PDF quebra descrições
 * longas ("17 JUL INDUSTRIA DE JOIAS C" / "06/10 CHAPECO R$ 110.00").
 *
 * Totais, saldos e limites ficam de fora justamente por não terem data. Sem
 * isso, "TOTAL R$ 8,165.23" viraria uma linha "faltando" em toda importação.
 */
export function entryLines(text: string): EntryLine[] {
  const lines = text.split("\n");
  const entries: EntryLine[] = [];

  lines.forEach((line, index) => {
    const amounts = amountsIn(line);
    if (amounts.length === 0) return;

    const previous = lines[index - 1] ?? "";
    const continuesPrevious = DATE_START.test(previous) && amountsIn(previous).length === 0;
    if (!DATE_START.test(line) && !continuesPrevious) return;

    entries.push({
      index,
      text: continuesPrevious ? `${previous.trim()} ${line.trim()}` : line.trim(),
      amounts,
    });
  });

  return entries;
}

/** Contagem de quantas vezes cada valor aparece. */
function countByAmount(values: number[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.toFixed(2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Linhas de lançamento sem valor correspondente entre os devolvidos. Percorre
 * na ordem do documento, consumindo uma ocorrência por linha: se o documento
 * traz duas compras de R$ 86,00 e o modelo devolveu uma, a segunda linha volta
 * marcada como não coberta.
 */
export function uncoveredEntries(entries: EntryLine[], rows: { amount: number }[]): EntryLine[] {
  const available = countByAmount(rows.map((row) => row.amount));

  return entries.filter((entry) => {
    const match = entry.amounts.find((amount) => (available.get(amount.toFixed(2)) ?? 0) > 0);
    if (match === undefined) return true;
    const key = match.toFixed(2);
    available.set(key, available.get(key)! - 1);
    return false;
  });
}

/**
 * Quantos lançamentos de cada valor o documento comporta. É o teto do que a
 * segunda passada pode acrescentar: impede que ela repita o que já veio, sem
 * bloquear duas compras legítimas de mesmo valor.
 */
export function capacityByAmount(entries: EntryLine[]): Map<string, number> {
  return countByAmount(entries.flatMap((entry) => entry.amounts));
}
