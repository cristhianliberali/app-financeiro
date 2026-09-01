/**
 * Camada 5 — quarentena.
 *
 * A decisão de produto mais importante do sistema, e ela é uma só: quando não
 * há certeza, o documento espera. Nunca degradação silenciosa.
 *
 * Num app financeiro um número errado exibido com confiança custa mais que dez
 * documentos que pediram confirmação. E um clique do usuário é mais barato e
 * mais confiável que três tentativas com um modelo melhor — cada confirmação
 * ainda vira rótulo, que alimenta o cache de merchants e a suíte dourada.
 *
 * Nada entra na tabela de transações antes de `confirmado`. `paraPersistir`
 * é o único caminho de saída, e ele levanta erro em qualquer outro estado.
 */
import type { Bbox, DocumentoCanonico } from "./canonical.server";
import type { ResultadoClassificacao } from "./classify.server";
import type { RelatorioReconciliacao } from "./reconcile";
import { TipoLinha, type DocumentoTipado, type LinhaTipada, type Parcela } from "./typing";

export const EstadoDocumento = {
  RECEBIDO: "recebido",
  CANONIZADO: "canonizado",
  TIPADO: "tipado",
  CLASSIFICADO: "classificado",
  RECONCILIADO: "reconciliado",
  QUARENTENA: "quarentena",
  CONFIRMADO: "confirmado",
} as const;

export type EstadoDocumento = (typeof EstadoDocumento)[keyof typeof EstadoDocumento];

/**
 * ```
 * recebido → canonizado → tipado → classificado → reconciliado → confirmado
 *                                       ↓
 *                                  quarentena → confirmado
 * ```
 */
export const TRANSICOES: Readonly<Record<EstadoDocumento, readonly EstadoDocumento[]>> = {
  [EstadoDocumento.RECEBIDO]: [EstadoDocumento.CANONIZADO],
  [EstadoDocumento.CANONIZADO]: [EstadoDocumento.TIPADO],
  [EstadoDocumento.TIPADO]: [EstadoDocumento.CLASSIFICADO, EstadoDocumento.QUARENTENA],
  [EstadoDocumento.CLASSIFICADO]: [EstadoDocumento.RECONCILIADO, EstadoDocumento.QUARENTENA],
  [EstadoDocumento.RECONCILIADO]: [EstadoDocumento.CONFIRMADO, EstadoDocumento.QUARENTENA],
  [EstadoDocumento.QUARENTENA]: [EstadoDocumento.CONFIRMADO],
  [EstadoDocumento.CONFIRMADO]: [],
};

export class TransicaoInvalidaError extends Error {
  constructor(de: EstadoDocumento, para: EstadoDocumento) {
    super(`Um documento em "${de}" não pode ir para "${para}".`);
    this.name = "TransicaoInvalidaError";
  }
}

export function transicionar(de: EstadoDocumento, para: EstadoDocumento): EstadoDocumento {
  if (!TRANSICOES[de].includes(para)) throw new TransicaoInvalidaError(de, para);
  return para;
}

export const MotivoQuarentena = {
  CONFIANCA_BAIXA: "confianca_baixa",
  RECONCILIACAO_ABERTA: "reconciliacao_aberta",
  DIVERGENCIA_DE_FRONTEIRA: "divergencia_de_fronteira",
  AMBIGUA_NAO_RESOLVIDA: "ambigua_nao_resolvida",
  SEM_VALOR_DETERMINISTICO: "sem_valor_deterministico",
  CONFLITO_DE_TIPO: "conflito_de_tipo",
  SANIDADE_VIOLADA: "sanidade_violada",
  LANCAMENTO_ORFAO: "lancamento_orfao",
} as const;

export type MotivoQuarentena = (typeof MotivoQuarentena)[keyof typeof MotivoQuarentena];

/** O que entraria na tabela de transações. Todo campo veio do parser. */
export type LancamentoProposto = {
  readonly linhaId: number;
  readonly descricao: string;
  readonly valor: number;
  readonly dataIso: string | null;
  readonly dataRaw: string | null;
  readonly categoria: string | null;
  readonly parcela: Parcela | null;
  readonly estorno: boolean;
  readonly confianca: number;
};

/** Onde recortar o documento original para mostrar a linha ao usuário. */
export type Ancora = {
  readonly pagina: number;
  readonly bbox: Bbox | null;
};

export type ItemRevisao = {
  readonly linhaId: number;
  readonly motivos: readonly MotivoQuarentena[];
  /**
   * Texto cru da linha, como saiu da camada 1 — nunca reescrito. Junto da
   * âncora, é o que permite mostrar o trecho original em vez de pedir fé.
   */
  readonly texto: string;
  readonly ancora: Ancora | null;
  /** O que seria lançado se a revisão aceitar. `null` quando falta dado. */
  readonly proposta: LancamentoProposto | null;
};

export type ResultadoQuarentena = {
  readonly estado: EstadoDocumento;
  /** Lançamentos sem pendência. Ainda assim só saem por `paraPersistir`. */
  readonly prontos: readonly LancamentoProposto[];
  readonly emRevisao: readonly ItemRevisao[];
  /** Pendências do documento como um todo, que não cabem numa linha só. */
  readonly motivosDoDocumento: readonly MotivoQuarentena[];
};

export class DocumentoNaoConfirmadoError extends Error {
  readonly estado: EstadoDocumento;
  readonly pendentes: number;

  constructor(estado: EstadoDocumento, pendentes: number) {
    super(
      `O documento está em "${estado}" com ${pendentes} item(ns) em revisão. ` +
        `Nada entra na tabela de transações antes de "confirmado".`,
    );
    this.name = "DocumentoNaoConfirmadoError";
    this.estado = estado;
    this.pendentes = pendentes;
  }
}

export const LIMIAR_CONFIANCA_PADRAO = 0.8;

/**
 * Decide o que está pronto e o que espera revisão.
 *
 * Os gatilhos são os cinco do desenho, mais os dois que as camadas 3 e 4
 * passaram a produzir: o modelo contradizer a tipagem determinística, e o
 * lançamento que não entrou em nenhum total que fechou.
 */
export function avaliar(input: {
  canonico: DocumentoCanonico;
  tipado: DocumentoTipado;
  classificacao: ResultadoClassificacao;
  reconciliacao: RelatorioReconciliacao;
  limiarConfianca?: number;
}): ResultadoQuarentena {
  const { canonico, tipado, classificacao, reconciliacao } = input;
  const limiar = input.limiarConfianca ?? LIMIAR_CONFIANCA_PADRAO;

  const decisaoPorId = new Map(classificacao.decisoes.map((decisao) => [decisao.id, decisao]));
  const linhaCanonica = new Map(canonico.linhas.map((linha) => [linha.id, linha]));

  const motivos = new Map<number, Set<MotivoQuarentena>>();
  const marcar = (id: number, motivo: MotivoQuarentena) => {
    const atuais = motivos.get(id) ?? new Set<MotivoQuarentena>();
    atuais.add(motivo);
    motivos.set(id, atuais);
  };

  for (const id of classificacao.divergencias)
    marcar(id, MotivoQuarentena.DIVERGENCIA_DE_FRONTEIRA);
  for (const id of classificacao.conflitosDeTipo) marcar(id, MotivoQuarentena.CONFLITO_DE_TIPO);
  for (const alerta of reconciliacao.alertas) {
    for (const id of alerta.linhas) marcar(id, MotivoQuarentena.SANIDADE_VIOLADA);
  }
  for (const id of reconciliacao.orfaos) marcar(id, MotivoQuarentena.LANCAMENTO_ORFAO);
  for (const fechamento of reconciliacao.totais) {
    if (!fechamento.fechou) marcar(fechamento.total.id, MotivoQuarentena.RECONCILIACAO_ABERTA);
  }

  const candidatas = tipado.linhas.filter(
    (linha) =>
      linha.absorvidaPor === null &&
      (linha.tipo === TipoLinha.LANCAMENTO || linha.tipo === TipoLinha.AMBIGUA),
  );

  const prontos: LancamentoProposto[] = [];
  const propostas = new Map<number, LancamentoProposto>();

  for (const linha of candidatas) {
    const decisao = decisaoPorId.get(linha.id);

    if (!decisao || decisao.confianca < limiar) {
      marcar(
        linha.id,
        linha.tipo === TipoLinha.AMBIGUA
          ? MotivoQuarentena.AMBIGUA_NAO_RESOLVIDA
          : MotivoQuarentena.CONFIANCA_BAIXA,
      );
    }

    const viraLancamento = (decisao?.tipo ?? linha.tipo) === TipoLinha.LANCAMENTO;
    if (!viraLancamento) continue;

    // O modelo pode dizer que a linha é lançamento, mas quem carrega o valor é
    // o parser. Sem valor determinístico não existe proposta — e é justamente
    // aqui que ele não tem como inventar um número para tapar o buraco.
    if (linha.valor === null || linha.descricao === null) {
      marcar(linha.id, MotivoQuarentena.SEM_VALOR_DETERMINISTICO);
      continue;
    }

    propostas.set(linha.id, {
      linhaId: linha.id,
      descricao: linha.descricao,
      valor: linha.valor,
      dataIso: linha.dataIso,
      dataRaw: linha.dataRaw,
      categoria: decisao?.categoria ?? null,
      parcela: linha.parcela,
      estorno: linha.estorno,
      confianca: decisao?.confianca ?? 0,
    });
  }

  const emRevisao: ItemRevisao[] = [];
  for (const [id, conjunto] of [...motivos].sort(([a], [b]) => a - b)) {
    const canonicaDaLinha = linhaCanonica.get(id);
    emRevisao.push({
      linhaId: id,
      motivos: [...conjunto],
      texto: canonicaDaLinha?.texto ?? "",
      ancora: canonicaDaLinha
        ? { pagina: canonicaDaLinha.pagina, bbox: canonicaDaLinha.bbox }
        : null,
      proposta: propostas.get(id) ?? null,
    });
  }

  for (const [id, proposta] of propostas) {
    if (!motivos.has(id)) prontos.push(proposta);
  }
  prontos.sort((a, b) => a.linhaId - b.linhaId);

  const motivosDoDocumento: MotivoQuarentena[] = [];
  if (!reconciliacao.fechouTudo) motivosDoDocumento.push(MotivoQuarentena.RECONCILIACAO_ABERTA);
  if (reconciliacao.alertas.some((alerta) => alerta.linhas.length === 0)) {
    motivosDoDocumento.push(MotivoQuarentena.SANIDADE_VIOLADA);
  }

  const limpo = emRevisao.length === 0 && motivosDoDocumento.length === 0;
  return {
    estado: transicionar(
      EstadoDocumento.RECONCILIADO,
      limpo ? EstadoDocumento.CONFIRMADO : EstadoDocumento.QUARENTENA,
    ),
    prontos,
    emRevisao,
    motivosDoDocumento,
  };
}

export type Revisao = {
  readonly linhaId: number;
  /** `false` descarta a linha: era total, ruído ou engano. */
  readonly aceitar: boolean;
  /** Categoria escolhida por quem revisou; sobrepõe a do modelo. */
  readonly categoria?: string | null;
};

/**
 * Aplica a revisão do usuário.
 *
 * O documento só sai da quarentena quando **todo** item pendente foi revisado —
 * inclusive as pendências do documento inteiro, que a revisão precisa aceitar
 * explicitamente. Item sem revisão mantém o documento onde está.
 */
export function confirmar(
  resultado: ResultadoQuarentena,
  revisoes: readonly Revisao[],
  opcoes: { aceitarPendenciasDoDocumento?: boolean } = {},
): ResultadoQuarentena {
  if (resultado.estado === EstadoDocumento.CONFIRMADO) return resultado;

  const porLinha = new Map(revisoes.map((revisao) => [revisao.linhaId, revisao]));
  const pendentes = resultado.emRevisao.filter((item) => !porLinha.has(item.linhaId));

  const aceitos: LancamentoProposto[] = [];
  for (const item of resultado.emRevisao) {
    const revisao = porLinha.get(item.linhaId);
    if (!revisao || !revisao.aceitar || !item.proposta) continue;
    aceitos.push(
      revisao.categoria === undefined
        ? item.proposta
        : { ...item.proposta, categoria: revisao.categoria, confianca: 1 },
    );
  }

  const documentoResolvido =
    resultado.motivosDoDocumento.length === 0 || opcoes.aceitarPendenciasDoDocumento === true;

  // Falta revisar alguma coisa: o documento continua exatamente onde estava.
  // Confirmar pela metade é a degradação silenciosa que esta camada existe
  // para impedir.
  if (pendentes.length > 0 || !documentoResolvido) return resultado;

  return {
    estado: transicionar(resultado.estado, EstadoDocumento.CONFIRMADO),
    prontos: [...resultado.prontos, ...aceitos].sort((a, b) => a.linhaId - b.linhaId),
    emRevisao: [],
    motivosDoDocumento: [],
  };
}

/** Único caminho de saída para o banco. Fora de `confirmado`, levanta erro. */
export function paraPersistir(resultado: ResultadoQuarentena): readonly LancamentoProposto[] {
  if (resultado.estado !== EstadoDocumento.CONFIRMADO) {
    throw new DocumentoNaoConfirmadoError(resultado.estado, resultado.emRevisao.length);
  }
  return resultado.prontos;
}

/**
 * Rótulos que a confirmação produz: descritor cru -> categoria. É o que
 * alimenta o cache de merchants e a suíte dourada da próxima importação.
 */
export function rotulosConfirmados(
  resultado: ResultadoQuarentena,
): Array<{ descritor: string; categoria: string }> {
  return paraPersistir(resultado).flatMap((lancamento) =>
    lancamento.categoria
      ? [{ descritor: lancamento.descricao, categoria: lancamento.categoria }]
      : [],
  );
}

/** Ajuda a tela: a linha tipada por trás de um item de revisão. */
export function linhaDe(tipado: DocumentoTipado, linhaId: number): LinhaTipada | undefined {
  return tipado.linhas.find((linha) => linha.id === linhaId);
}
