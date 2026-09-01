/**
 * O pipeline inteiro, das cinco camadas em ordem.
 *
 * Existe para poder rodar o desenho de ponta a ponta contra a fixture dourada,
 * e para dar um ponto único de entrada quando a tela passar a usar este
 * caminho. Cada camada continua testável sozinha — aqui só há a costura.
 *
 * Nenhum lançamento sai daqui direto para o banco: o resultado da camada 5 é
 * quem decide, e a saída é sempre por `paraPersistir`.
 */
import {
  canonizar,
  type DocumentoCanonico,
  type EntradaArquivo,
  type OpcoesCanonizacao,
} from "./canonical.server";
import {
  classificar,
  type Categoria,
  type OpcoesClassificacao,
  type ResultadoClassificacao,
} from "./classify.server";
import type { CacheMerchants } from "./merchants.server";
import type { LlmClient } from "./provider.server";
import { reconciliar, type RelatorioReconciliacao, type Validador } from "./reconcile";
import { avaliar, type ResultadoQuarentena } from "./quarantine";
import { tipar, type DocumentoTipado } from "./typing";

export type ResultadoPipeline = {
  readonly canonico: DocumentoCanonico;
  readonly tipado: DocumentoTipado;
  readonly classificacao: ResultadoClassificacao;
  readonly reconciliacao: RelatorioReconciliacao;
  readonly quarentena: ResultadoQuarentena;
};

export async function processar(input: {
  arquivo: EntradaArquivo;
  categorias: readonly Categoria[];
  cliente: LlmClient;
  cache?: CacheMerchants;
  /** Injetável para os testes não dependerem do relógio. */
  hoje?: Date;
  opcoes?: {
    canonizacao?: OpcoesCanonizacao;
    classificacao?: OpcoesClassificacao;
    validadores?: readonly Validador[];
    limiarConfianca?: number;
  };
}): Promise<ResultadoPipeline> {
  const opcoes = input.opcoes ?? {};

  const canonico = await canonizar(input.arquivo, opcoes.canonizacao ?? {});
  const tipado = tipar(canonico, input.hoje ? { hoje: input.hoje } : {});
  const classificacao = await classificar({
    documento: tipado,
    categorias: input.categorias,
    cliente: input.cliente,
    ...(input.cache ? { cache: input.cache } : {}),
    ...(opcoes.classificacao ? { opcoes: opcoes.classificacao } : {}),
  });
  const reconciliacao = reconciliar(
    tipado,
    opcoes.validadores ? { validadores: opcoes.validadores } : {},
  );
  const quarentena = avaliar({
    canonico,
    tipado,
    classificacao,
    reconciliacao,
    ...(opcoes.limiarConfianca === undefined ? {} : { limiarConfianca: opcoes.limiarConfianca }),
  });

  return { canonico, tipado, classificacao, reconciliacao, quarentena };
}
