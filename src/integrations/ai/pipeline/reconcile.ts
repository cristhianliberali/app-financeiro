/**
 * Camada 4 — reconciliação.
 *
 * Confirma que a **tipagem** está correta. Não é o detector de omissão: a
 * omissão já foi eliminada na camada 3, pelo contrato de contagem dos blocos.
 * Aqui é o segundo sinal, e ele é independente do primeiro.
 *
 * O método é agnóstico de emissor porque todo documento financeiro carrega os
 * próprios checksums: existe um total, e as linhas têm que somar nele. Se
 * nenhum total fecha, há tipagem errada em algum lugar.
 */
import {
  TipoLinha,
  lancamentos,
  valoresDaLinha,
  valoresIncompativeis,
  type DocumentoTipado,
  type LinhaTipada,
} from "./typing";

/** Centavos, para somar sem o arredondamento do ponto flutuante. */
const centavos = (valor: number) => Math.round(valor * 100);

export type TotalDeclarado = {
  readonly id: number;
  /** O texto do rótulo, sem a coluna do valor. */
  readonly rotulo: string;
  readonly valor: number;
  readonly grupo: number | null;
  /**
   * Total que a conferência **exige** fechar: o rótulo anuncia um total desta
   * fatura ("TOTAL", "SALDO TOTAL", "TOTAL DE FULANO"). O que a fatura declara
   * mas não é soma das linhas — limite, taxa, pagamento mínimo, dívida futura,
   * saldo para a próxima — continua no relatório, mas não bloqueia nada: exigir
   * que "TOTAL DA DÍVIDA A VENCER" some com as compras do mês só gera alarme
   * falso, e alarme falso ensina a ignorar alarme.
   */
  readonly conferivel: boolean;
};

/**
 * Como um total fechou, do sinal mais forte para o mais fraco.
 *
 * `grupo` é o caso limpo: as linhas do próprio bloco somam o subtotal dele.
 * `busca` é o mais fraco — um subconjunto qualquer bateu com o valor —, e por
 * isso aparece nomeado no relatório em vez de virar um "fechou" indistinto.
 */
export type ViaDeFechamento = "grupo" | "subtotais" | "identidade" | "documento" | "busca";

export type FechamentoTotal = {
  readonly total: TotalDeclarado;
  readonly fechou: boolean;
  readonly via: ViaDeFechamento | null;
  /** Ids das linhas que somam o valor declarado. */
  readonly parcelas: readonly number[];
  /** Declarado menos encontrado. Zero quando fechou. */
  readonly diferenca: number;
};

export type Alerta = {
  readonly validador: string;
  readonly mensagem: string;
  readonly linhas: readonly number[];
};

export type RelatorioReconciliacao = {
  readonly totais: readonly FechamentoTotal[];
  /** Lançamentos que não entraram em nenhum total que fechou. */
  readonly orfaos: readonly number[];
  readonly alertas: readonly Alerta[];
  readonly fechouTudo: boolean;
};

/* ------------------------------------------------------------------ *
 * Busca de subconjuntos
 * ------------------------------------------------------------------ */

/** Teto de estados da busca genérica, para a complexidade não escapar. */
const TETO_ESTADOS = 200_000;
/** Acima disto a busca por combinação assinada é cara demais para valer a pena. */
const MAX_TOTAIS_NA_IDENTIDADE = 12;

type Item = { id: number; centavos: number };

/**
 * Subconjunto que soma exatamente o alvo, ou `null`.
 *
 * Programação dinâmica sobre as somas alcançáveis, guardando o caminho. Aceita
 * valores negativos, porque estorno é um lançamento como outro qualquer. O teto
 * de estados corta a busca antes de ela virar problema — e, quando corta,
 * devolver `null` é a resposta certa: "não achei" é melhor que travar.
 */
export function subconjuntoQueSoma(itens: readonly Item[], alvo: number): number[] | null {
  // O subconjunto vazio fica fora do mapa: senão a soma zero já viria ocupada
  // por ele, e um par lançamento + estorno nunca fecharia um total de 0,00.
  const alcancaveis = new Map<number, number[]>();

  for (const item of itens) {
    const novos: Array<[number, number[]]> = [];
    if (!alcancaveis.has(item.centavos)) novos.push([item.centavos, [item.id]]);
    for (const [soma, caminho] of alcancaveis) {
      const proxima = soma + item.centavos;
      if (alcancaveis.has(proxima)) continue;
      novos.push([proxima, [...caminho, item.id]]);
    }
    for (const [soma, caminho] of novos) {
      if (!alcancaveis.has(soma)) alcancaveis.set(soma, caminho);
    }
    if (alcancaveis.size > TETO_ESTADOS) break;
  }

  return alcancaveis.get(alvo) ?? null;
}

/**
 * Combinação assinada dos outros totais do mesmo bloco que dá no alvo.
 *
 * É a identidade que todo resumo de fatura carrega — anterior, menos
 * pagamentos, mais encargos, mais compras, igual ao total a pagar. Nenhum
 * emissor precisa ser conhecido para procurá-la: basta que os totais estejam no
 * mesmo bloco.
 */
export function combinacaoAssinada(itens: readonly Item[], alvo: number): number[] | null {
  if (itens.length === 0 || itens.length > MAX_TOTAIS_NA_IDENTIDADE) return null;

  let estados = new Map<number, number[]>([[0, []]]);
  for (const item of itens) {
    const proximos = new Map<number, number[]>();
    for (const [soma, caminho] of estados) {
      for (const sinal of [0, 1, -1]) {
        const nova = soma + sinal * item.centavos;
        const proximo = sinal === 0 ? caminho : [...caminho, item.id];
        if (!proximos.has(nova)) proximos.set(nova, proximo);
      }
    }
    estados = proximos;
  }

  const caminho = estados.get(alvo);
  return caminho && caminho.length > 0 ? caminho : null;
}

/* ------------------------------------------------------------------ *
 * Sanidade semântica
 * ------------------------------------------------------------------ */

export type ContextoSanidade = {
  readonly documento: DocumentoTipado;
  readonly lancamentos: readonly LinhaTipada[];
};

export type Validador = {
  readonly nome: string;
  verificar(contexto: ContextoSanidade): Alerta[];
};

/**
 * Data fora do período.
 *
 * Depois do fim é sempre erro — documento não traz compra do futuro. Antes do
 * começo só é erro quando a linha não é parcela: `17 JUL` numa fatura de
 * fevereiro é a sexta de dez parcelas de uma compra do ano passado, e isso é o
 * comportamento normal, não anomalia.
 */
export const datasNoPeriodo: Validador = {
  nome: "datas-no-periodo",
  verificar({ documento, lancamentos: linhas }) {
    const { inicio, fim } = documento.periodo;
    const alertas: Alerta[] = [];

    const adiante = linhas.filter((linha) => fim && linha.dataIso && linha.dataIso > fim);
    if (adiante.length > 0) {
      alertas.push({
        validador: "datas-no-periodo",
        mensagem: `${adiante.length} lançamento(s) com data posterior ao fim do período (${fim}).`,
        linhas: adiante.map((linha) => linha.id),
      });
    }

    const atras = linhas.filter(
      (linha) => inicio && linha.dataIso && linha.dataIso < inicio && linha.parcela === null,
    );
    if (atras.length > 0) {
      alertas.push({
        validador: "datas-no-periodo",
        mensagem:
          `${atras.length} lançamento(s) anteriores ao início do período (${inicio}) ` +
          `sem marca de parcela.`,
        linhas: atras.map((linha) => linha.id),
      });
    }

    return alertas;
  },
};

/**
 * Valor maior que o próprio documento comporta.
 *
 * Um lançamento acima de uma vez e meia o maior total declarado quase sempre é
 * convenção decimal lida errado — é assim que `29,90` vira 2990.
 */
export const valorAcimaDoDocumento: Validador = {
  nome: "valor-acima-do-documento",
  verificar({ documento, lancamentos: linhas }) {
    const teto =
      Math.max(
        0,
        ...documento.linhas
          .filter((linha) => linha.tipo === TipoLinha.TOTAL_DECLARADO)
          .flatMap((linha) => linha.valores.map(Math.abs)),
      ) * 1.5;
    if (teto === 0) return [];

    const fora = linhas.filter((linha) => Math.abs(linha.valor ?? 0) > teto);
    if (fora.length === 0) return [];
    return [
      {
        validador: "valor-acima-do-documento",
        mensagem: `${fora.length} lançamento(s) acima de ${teto.toFixed(2)}, o teto do documento.`,
        linhas: fora.map((linha) => linha.id),
      },
    ];
  },
};

/**
 * Convenção decimal uniforme em 100% das linhas.
 *
 * É o segundo sinal, independente: a camada 2 já recusa o documento com
 * convenção mista na hora de detectá-la. Este validador cobre o que passar por
 * lá — uma linha reextraída, um valor corrigido à mão na revisão.
 */
export const convencaoUniforme: Validador = {
  nome: "convencao-uniforme",
  verificar({ documento }) {
    const fora = documento.linhas.filter(
      (linha) => valoresIncompativeis(linha.texto, documento.convencao).length > 0,
    );
    if (fora.length === 0) return [];
    return [
      {
        validador: "convencao-uniforme",
        mensagem:
          `${fora.length} linha(s) com valor escrito fora da convenção ` +
          `"${documento.convencao}" detectada para o documento.`,
        linhas: fora.map((linha) => linha.id),
      },
    ];
  },
};

/**
 * Contagem de lançamentos dentro da faixa histórica daquele usuário. Depende de
 * histórico, então é montado pelo chamador em vez de vir ligado por padrão.
 */
export function contagemNaFaixa(minimo: number, maximo: number): Validador {
  return {
    nome: "contagem-na-faixa",
    verificar({ lancamentos: linhas }) {
      if (linhas.length >= minimo && linhas.length <= maximo) return [];
      return [
        {
          validador: "contagem-na-faixa",
          mensagem:
            `${linhas.length} lançamento(s), fora da faixa histórica ` +
            `de ${minimo} a ${maximo}.`,
          linhas: [],
        },
      ];
    },
  };
}

export const VALIDADORES_PADRAO: readonly Validador[] = [
  datasNoPeriodo,
  valorAcimaDoDocumento,
  convencaoUniforme,
];

/* ------------------------------------------------------------------ *
 * Reconciliação
 * ------------------------------------------------------------------ */

/** O rótulo de um total: a linha sem as colunas que são só valor. */
function rotuloDe(linha: LinhaTipada): string {
  return linha.texto
    .split(/\s{2,}|\s\|\s/)
    .map((coluna) => coluna.trim())
    .filter((coluna) => coluna !== "" && !/^-?\s*(?:R\$\s*)?-?[\d.,]+-?$/.test(coluna))
    .join(" ")
    .trim();
}

/** O rótulo anuncia um total de verdade. */
const ROTULO_TOTAL = /\b(?:sub)?tota(?:l|is)\b/i;

/**
 * Vocabulário genérico do que uma fatura declara sem que seja soma das linhas:
 * projeções, limites, encargos e mínimos. Vale para o rótulo e para o marcador
 * do bloco em que ele está.
 */
const CONTEXTO_NAO_CONFERIVEL =
  /pr[oó]xim|a vencer|d[íi]vida|limite|dispon[íi]vel|m[íi]nimo|taxa|juro|encargo|\biof\b|\bcet\b|tarifa|futur|[úu]ltimos/i;

export function totaisDeclarados(documento: DocumentoTipado): TotalDeclarado[] {
  const porId = new Map(documento.linhas.map((linha) => [linha.id, linha]));

  return documento.linhas
    .filter((linha) => linha.tipo === TipoLinha.TOTAL_DECLARADO)
    .flatMap((linha) => {
      const encontroTotal = ROTULO_TOTAL.exec(linha.texto);
      // Num total anunciado, o valor é o que vem logo depois da palavra: numa
      // faixa de resumo ("TOTAL R$ X ... PAGAMENTO MÍNIMO R$ Y") o último
      // valor da linha é o mínimo, não o total.
      const aposPalavra = encontroTotal
        ? valoresDaLinha(linha.texto.slice(encontroTotal.index), documento.convencao)
        : [];
      const valor = aposPalavra[0] ?? linha.valores[linha.valores.length - 1];
      if (valor === undefined) return [];

      const rotuloDoGrupo = linha.grupo === null ? "" : (porId.get(linha.grupo)?.texto ?? "");
      const conferivel =
        encontroTotal !== null &&
        valor > 0 &&
        !CONTEXTO_NAO_CONFERIVEL.test(linha.texto) &&
        !CONTEXTO_NAO_CONFERIVEL.test(rotuloDoGrupo);

      return [{ id: linha.id, rotulo: rotuloDe(linha), valor, grupo: linha.grupo, conferivel }];
    });
}

/**
 * Reconcilia o documento tipado.
 *
 * Cada total declarado é buscado na ordem do sinal mais forte para o mais
 * fraco: as linhas do próprio bloco, a soma dos subtotais que já fecharam, a
 * identidade assinada do bloco de resumo, o documento inteiro e, por último, a
 * busca de subconjunto — limitada ao bloco do total, para não sair casando
 * valor de portador com linha de outro.
 */
export function reconciliar(
  documento: DocumentoTipado,
  opcoes: { validadores?: readonly Validador[] } = {},
): RelatorioReconciliacao {
  const linhas = lancamentos(documento);
  const totais = totaisDeclarados(documento);

  const itensDe = (conjunto: readonly LinhaTipada[]): Item[] =>
    conjunto
      .filter((linha) => linha.valor !== null)
      .map((linha) => ({ id: linha.id, centavos: centavos(linha.valor!) }));

  const porGrupo = new Map<number | null, LinhaTipada[]>();
  for (const linha of linhas) {
    porGrupo.set(linha.grupo, [...(porGrupo.get(linha.grupo) ?? []), linha]);
  }

  const todos = itensDe(linhas);
  const somaTotal = todos.reduce((soma, item) => soma + item.centavos, 0);

  // Primeira passada: só o caso limpo, em que o bloco soma o próprio subtotal.
  // O resultado dela é o que alimenta a busca por soma de subtotais depois.
  const porGrupoFechado: FechamentoTotal[] = totais.map((total) => {
    const doGrupo = porGrupo.get(total.grupo) ?? [];
    const itens = itensDe(doGrupo);
    const soma = itens.reduce((acumulado, item) => acumulado + item.centavos, 0);
    const alvo = centavos(total.valor);
    return itens.length > 0 && soma === alvo
      ? {
          total,
          fechou: true,
          via: "grupo" as const,
          parcelas: itens.map((item) => item.id),
          diferenca: 0,
        }
      : { total, fechou: false, via: null, parcelas: [], diferenca: (alvo - soma) / 100 };
  });

  const subtotais: Item[] = porGrupoFechado
    .filter((fechamento) => fechamento.fechou)
    .map((fechamento) => ({
      id: fechamento.total.id,
      centavos: centavos(fechamento.total.valor),
    }));

  const resultado: FechamentoTotal[] = porGrupoFechado.map((fechamento) => {
    if (fechamento.fechou) return fechamento;

    const { total } = fechamento;
    const alvo = centavos(total.valor);

    const porSubtotais = subconjuntoQueSoma(
      subtotais.filter((item) => item.id !== total.id),
      alvo,
    );
    if (porSubtotais) {
      return { total, fechou: true, via: "subtotais", parcelas: porSubtotais, diferenca: 0 };
    }

    const irmaos = totais
      .filter((outro) => outro.id !== total.id && outro.grupo === total.grupo)
      .map((outro) => ({ id: outro.id, centavos: centavos(outro.valor) }));
    const porIdentidade = combinacaoAssinada(irmaos, alvo);
    if (porIdentidade) {
      return { total, fechou: true, via: "identidade", parcelas: porIdentidade, diferenca: 0 };
    }

    if (todos.length > 0 && somaTotal === alvo) {
      return {
        total,
        fechou: true,
        via: "documento",
        parcelas: todos.map((item) => item.id),
        diferenca: 0,
      };
    }

    const candidatos = porGrupo.get(total.grupo)?.length
      ? itensDe(porGrupo.get(total.grupo)!)
      : todos;
    const porBusca = subconjuntoQueSoma(candidatos, alvo);
    if (porBusca) {
      return { total, fechou: true, via: "busca", parcelas: porBusca, diferenca: 0 };
    }

    return fechamento;
  });

  const cobertos = new Set(
    resultado
      .filter((fechamento) => fechamento.fechou)
      .flatMap((fechamento) => fechamento.parcelas),
  );
  const orfaos = linhas.filter((linha) => !cobertos.has(linha.id)).map((linha) => linha.id);

  const validadores = opcoes.validadores ?? VALIDADORES_PADRAO;
  const alertas = validadores.flatMap((validador) =>
    validador.verificar({ documento, lancamentos: linhas }),
  );

  // Só os conferíveis decidem o veredito. Os demais ficam no relatório com a
  // via por onde fecharam (ou não), como informação — nunca como alarme.
  const conferiveis = resultado.filter((fechamento) => fechamento.total.conferivel);

  return {
    totais: resultado,
    orfaos,
    alertas,
    fechouTudo: conferiveis.length > 0 && conferiveis.every((fechamento) => fechamento.fechou),
  };
}
