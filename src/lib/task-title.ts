/**
 * O nome da tarefa como ele aparece nas listagens.
 *
 * Um título pode ter o tamanho que a pessoa quiser — o banco não limita, e às
 * vezes o nome é a própria descrição do que precisa ser feito. Isso é bom na
 * hora de escrever e ruim na hora de ler: num quadro kanban, um título de
 * trezentos caracteres empurra o cartão para três linhas e some com os cartões
 * vizinhos; numa tabela, estica a coluna e espreme o resto.
 *
 * Então a listagem mostra os primeiros 70 caracteres e marca o corte com "…".
 * A tarefa aberta mostra o nome inteiro, sempre — é lá que ele é lido e
 * editado, e é por isso que cortar aqui não perde nada.
 *
 * O corte é por caractere, e não pelo `truncate` do CSS, porque são coisas
 * diferentes que se somam: o CSS corta pelo espaço que sobrou na tela (e varia
 * com a largura da janela), este corte impõe um teto que não depende de layout
 * nenhum. As classes `truncate` que já existem continuam onde estão.
 *
 * Puro e sem dependência: as duas funções valem para qualquer lugar que exiba
 * um nome de tarefa, e são testadas em `test/task-title.test.ts`.
 */

/** Teto do nome nas listagens, contando o "…" que marca o corte. */
export const MAX_TITULO_VISIVEL = 70;

/**
 * Quanto o corte pode recuar para cair num espaço em vez de no meio de uma
 * palavra. Recuar demais desperdiçaria linha; um título de palavra única e
 * gigante (uma URL colada, por exemplo) é cortado no osso mesmo.
 */
const RECUO_MAXIMO = 12;

/** Espaços, quebras de linha e tabulações viram um espaço só. */
function normalizar(titulo: string): string {
  return titulo.replace(/\s+/g, " ").trim();
}

/**
 * O nome encurtado para caber numa listagem, com "…" quando foi cortado.
 *
 * O resultado nunca passa de `MAX_TITULO_VISIVEL` caracteres, reticências
 * incluídas: o teto é do que aparece na tela, não do texto antes de marcá-lo.
 */
export function resumirTitulo(titulo: string): string {
  const limpo = normalizar(titulo);
  if (limpo.length <= MAX_TITULO_VISIVEL) return limpo;

  // -1 abre espaço para o "…", que faz parte do que a pessoa vê.
  const corte = limpo.slice(0, MAX_TITULO_VISIVEL - 1);
  const ultimoEspaco = corte.lastIndexOf(" ");
  const base =
    ultimoEspaco >= MAX_TITULO_VISIVEL - 1 - RECUO_MAXIMO ? corte.slice(0, ultimoEspaco) : corte;

  // Pontuação encostada nas reticências ("contrato,…") parece erro de código.
  return `${base.trimEnd().replace(/[,;:.!?/\-–—]+$/, "")}…`;
}

/**
 * O nome inteiro para o `title=` nativo — e `undefined` quando ele não foi
 * cortado.
 *
 * A distinção importa: uma dica de tela repetindo palavra por palavra o que já
 * está à vista é ruído em cada tarefa da lista. Aqui ela só existe quando tem o
 * que acrescentar, e serve de atalho para quem quer conferir o nome sem abrir
 * a tarefa.
 */
export function tituloPorExtenso(titulo: string): string | undefined {
  const limpo = normalizar(titulo);
  return limpo.length > MAX_TITULO_VISIVEL ? limpo : undefined;
}
