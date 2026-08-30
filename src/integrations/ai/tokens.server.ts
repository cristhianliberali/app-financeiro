/**
 * Contagem de tokens e divisão em lotes.
 *
 * A contagem acontece antes de qualquer requisição: documento acima de
 * `LIMITE_TOKENS` é dividido, e cada lote vira uma requisição separada. Assim
 * o custo é previsível e nenhuma fatura é truncada em silêncio.
 */

/** Encoder do o200k_base, usado pelos modelos atuais da OpenAI. */
async function encoder() {
  return import("gpt-tokenizer/encoding/o200k_base");
}

export async function countTokens(text: string): Promise<number> {
  const { encode } = await encoder();
  return encode(text).length;
}

export type Batch = { index: number; text: string; tokens: number };

/** Começo de lançamento: "01 DEZ", "01/12", "01/12/2026", "2026-01-12". */
const DATE_START =
  /^\s*(?:\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?|\d{1,2}\s+[A-Za-zÀ-ÿ]{3,}|\d{4}-\d{2}-\d{2})\b/;

/** Linha com valor em centavos — é o que caracteriza um lançamento completo. */
const HAS_AMOUNT = /\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?![\d.,])/;

/**
 * Divide o texto em lotes.
 *
 * Dois limites, e vale o que estourar primeiro:
 *
 *   - `tokenLimit` mantém o custo por requisição previsível;
 *   - `entryLimit` mantém a resposta curta o bastante para o modelo transcrever
 *     tudo. Este é o que importa numa fatura grande: pedir cem lançamentos de
 *     uma vez faz o modelo pular linhas, e ele não avisa quando pula.
 *
 * O corte acontece sempre numa linha que começa lançamento novo — uma descrição
 * quebrada em duas linhas pelo PDF ("17 JUL INDUSTRIA DE JOIAS C" seguida de
 * "06/10 CHAPECO R$ 110.00") nunca fica partida entre dois lotes. Uma linha
 * sozinha maior que o limite de tokens é enviada mesmo assim, em lote próprio.
 */
export async function splitIntoBatches(
  text: string,
  tokenLimit: number,
  entryLimit = Number.POSITIVE_INFINITY,
): Promise<Batch[]> {
  const { encode } = await encoder();
  const lines = text.split("\n");

  const batches: Batch[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let currentEntries = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push({ index: batches.length, text: current.join("\n"), tokens: currentTokens });
    current = [];
    currentTokens = 0;
    currentEntries = 0;
  };

  lines.forEach((line, index) => {
    // +1 aproxima o token da quebra de linha que volta na junção.
    const lineTokens = encode(line).length + 1;

    // Só é lançamento novo quando a linha anterior já fechou o seu valor; senão
    // é a continuação de uma descrição quebrada, que precisa ficar no mesmo lote.
    const previous = lines[index - 1] ?? "";
    const startsEntry = DATE_START.test(line) && (index === 0 || HAS_AMOUNT.test(previous));

    if (currentTokens > 0 && currentTokens + lineTokens > tokenLimit) flush();
    else if (startsEntry && currentEntries >= entryLimit) flush();

    current.push(line);
    currentTokens += lineTokens;
    if (HAS_AMOUNT.test(line)) currentEntries += 1;
  });
  flush();

  return batches;
}
