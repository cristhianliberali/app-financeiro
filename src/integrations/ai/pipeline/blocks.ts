/**
 * Divisão em blocos para a camada 3.
 *
 * Blocos pequenos e sem estado são o que elimina a condição para o modelo
 * "esquecer" no meio de uma lista longa: nenhuma chamada é comprida o
 * suficiente para haver o que esquecer, e cada uma é retentável sozinha.
 *
 * As bordas se sobrepõem de propósito. Cada linha de fronteira é julgada duas
 * vezes, em blocos diferentes; se as decisões divergirem, a linha vai para
 * revisão. É o que impede perda justamente no ponto de corte.
 */

export type Bloco = {
  readonly indice: number;
  /** Ids do bloco, na ordem do documento, incluindo os de sobreposição. */
  readonly ids: readonly number[];
  /** Ids que também estão no bloco anterior — julgados duas vezes. */
  readonly sobrepostos: readonly number[];
};

export const TAMANHO_BLOCO_PADRAO = 25;
export const SOBREPOSICAO_PADRAO = 2;

/**
 * Divide os ids em blocos de `tamanho`, com `sobreposicao` ids repetidos entre
 * blocos consecutivos.
 *
 * O último bloco nunca é só sobreposição: quando a sobra cabe inteira no bloco
 * anterior, ela não vira bloco novo — seria uma chamada paga para reperguntar
 * o que já foi respondido.
 */
export function dividirEmBlocos(
  ids: readonly number[],
  tamanho: number = TAMANHO_BLOCO_PADRAO,
  sobreposicao: number = SOBREPOSICAO_PADRAO,
): Bloco[] {
  if (ids.length === 0) return [];
  if (tamanho < 1) throw new Error("O tamanho do bloco precisa ser pelo menos 1.");
  if (sobreposicao < 0 || sobreposicao >= tamanho) {
    throw new Error(
      `A sobreposição (${sobreposicao}) precisa ser menor que o tamanho do bloco (${tamanho}).`,
    );
  }

  const passo = tamanho - sobreposicao;
  const blocos: Bloco[] = [];

  for (let inicio = 0; inicio < ids.length; inicio += passo) {
    const fatia = ids.slice(inicio, inicio + tamanho);
    const anterior = blocos[blocos.length - 1];
    const cobertos = new Set(anterior?.ids ?? []);

    // Sobra que o bloco anterior já cobre por inteiro não vira chamada nova.
    if (anterior && fatia.every((id) => cobertos.has(id))) break;

    blocos.push({
      indice: blocos.length,
      ids: fatia,
      sobrepostos: fatia.filter((id) => cobertos.has(id)),
    });

    if (inicio + tamanho >= ids.length) break;
  }

  return blocos;
}

/**
 * Roda as tarefas com um teto de concorrência, preservando a ordem do
 * resultado. Blocos são independentes, então o paralelismo é de graça — o teto
 * existe só para não estourar o limite de requisições do provedor.
 */
export async function emParalelo<T, R>(
  itens: readonly T[],
  limite: number,
  tarefa: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;

  const trabalhador = async (): Promise<void> => {
    for (;;) {
      const indice = proximo;
      proximo += 1;
      if (indice >= itens.length) return;
      resultados[indice] = await tarefa(itens[indice]!, indice);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, itens.length)) }, trabalhador),
  );
  return resultados;
}
