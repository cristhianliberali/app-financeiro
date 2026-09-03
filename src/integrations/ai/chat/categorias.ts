/**
 * Casamento do nome de categoria que o modelo devolveu com as categorias que a
 * subconta realmente tem.
 *
 * O modelo escolhe entre as categorias que recebeu no prompt, mas escreve o
 * nome à mão — e "alimentacao", "Alimentação " e "comida" precisam chegar na
 * mesma linha do banco. Nada aqui é específico de banco emissor nem de
 * categoria: é comparação de texto, e por isso o módulo é puro e testado.
 *
 * Quando nada casa, a resposta é `null`, e não um palpite. Um lançamento na
 * categoria errada é pior do que um lançamento que espera a pessoa escolher a
 * categoria na hora de confirmar.
 */

export type CategoriaRef = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string;
  monthly_cap: number | null;
  description: string | null;
  archived_at: string | null;
};

/** Minúsculas, sem acento e sem espaço sobrando — a forma em que se compara. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras-chave da descrição da categoria ("IFOOD, PADARIA" -> ["ifood","padaria"]). */
function palavrasChave(categoria: CategoriaRef): string[] {
  return (categoria.description ?? "")
    .split(/[,;/\n]/)
    .map((termo) => normalizar(termo))
    .filter((termo) => termo.length >= 3);
}

export type CasamentoOpts = {
  /** Restringe a busca ao lado certo do lançamento (despesa ou receita). */
  kind?: "income" | "expense";
  /**
   * Consulta pode falar de categoria arquivada — ela some do lançamento novo,
   * mas continua nos relatórios do que já foi lançado. Registro, não.
   */
  incluirArquivadas?: boolean;
};

/**
 * A categoria que corresponde ao nome pedido, em três tentativas, da mais
 * exata para a mais frouxa: nome igual, nome contido, palavra-chave da
 * descrição. Ambíguo no mesmo nível conta como não encontrado.
 */
export function casarCategoria(
  nome: string | null,
  categorias: CategoriaRef[],
  opts: CasamentoOpts = {},
): CategoriaRef | null {
  if (!nome?.trim()) return null;

  const alvo = normalizar(nome);
  if (!alvo) return null;

  const candidatas = categorias.filter(
    (categoria) =>
      (opts.incluirArquivadas === true || categoria.archived_at === null) &&
      (opts.kind === undefined || categoria.kind === opts.kind),
  );

  const exata = candidatas.filter((categoria) => normalizar(categoria.name) === alvo);
  if (exata.length === 1) return exata[0]!;
  // Duas categorias com o mesmo nome (uma de entrada, outra de saída) é caso
  // real; com o lado já filtrado, a primeira é a resposta certa.
  if (exata.length > 1) return exata[0]!;

  // Contido nos dois sentidos: "alimentacao e bebidas" casa com "Alimentação",
  // e "aliment" também. Menos de três letras não filtra nada de útil.
  if (alvo.length >= 3) {
    const parciais = candidatas.filter((categoria) => {
      const nomeCategoria = normalizar(categoria.name);
      return nomeCategoria.includes(alvo) || alvo.includes(nomeCategoria);
    });
    if (parciais.length === 1) return parciais[0]!;
  }

  const porPalavraChave = candidatas.filter((categoria) =>
    palavrasChave(categoria).some((termo) => termo === alvo || alvo.includes(termo)),
  );
  if (porPalavraChave.length === 1) return porPalavraChave[0]!;

  return null;
}
