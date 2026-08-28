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

/**
 * Divide o texto em lotes respeitando o limite de tokens, sempre cortando em
 * quebra de linha — uma linha de fatura nunca fica partida entre dois lotes.
 * Uma linha sozinha maior que o limite é enviada mesmo assim, em lote próprio.
 */
export async function splitIntoBatches(text: string, tokenLimit: number): Promise<Batch[]> {
  const { encode } = await encoder();
  const lines = text.split("\n");

  const batches: Batch[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push({ index: batches.length, text: current.join("\n"), tokens: currentTokens });
    current = [];
    currentTokens = 0;
  };

  for (const line of lines) {
    // +1 aproxima o token da quebra de linha que volta na junção.
    const lineTokens = encode(line).length + 1;
    if (currentTokens > 0 && currentTokens + lineTokens > tokenLimit) flush();
    current.push(line);
    currentTokens += lineTokens;
  }
  flush();

  return batches;
}
