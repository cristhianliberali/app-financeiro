/**
 * Camada 2 — tipagem determinística.
 *
 * Classifica o máximo possível sem LLM e **sem qualquer conhecimento de
 * emissor**. Uma linha com data + valor + texto no meio é um lançamento em
 * qualquer fatura do mundo; esse é o nível de generalidade a manter. Se
 * aparecer a necessidade de escrever o nome de um banco aqui, o problema é da
 * regra, não do documento.
 *
 * O que esta camada não resolve vira `AMBIGUA` e segue para a camada 3. Nada é
 * descartado: a soma das linhas por tipo é sempre igual ao total de linhas do
 * documento canônico.
 */
import { stripInstallmentSuffix } from "@/lib/installments";

import type { DocumentoCanonico, Linha } from "./canonical.server";

export const TipoLinha = {
  /** Data + valor + descrição. */
  LANCAMENTO: "LANCAMENTO",
  /** Rótulo + valor, sem data própria: total, saldo, limite, resumo. */
  TOTAL_DECLARADO: "TOTAL_DECLARADO",
  /** Rótulos de coluna. */
  CABECALHO: "CABECALHO",
  /** Separador de bloco — portador, conta, seção. */
  MARCADOR_GRUPO: "MARCADOR_GRUPO",
  /** Rodapé, telefone, texto legal. */
  RUIDO: "RUIDO",
  /** Não resolvida aqui; vai para o LLM na camada 3. */
  AMBIGUA: "AMBIGUA",
} as const;

export type TipoLinha = (typeof TipoLinha)[keyof typeof TipoLinha];

/**
 * Como o documento escreve os números.
 *
 * `us` é ponto decimal e vírgula de milhar (`6,598.58`), `br` é o contrário
 * (`6.598,58`). A fatura de referência é brasileira e imprime no padrão
 * americano — daí a convenção ser detectada por documento, e não fixada.
 * `indeterminada` é o documento em que nenhum valor tem separador de milhar:
 * as duas convenções leem o mesmo número, então não há o que decidir.
 */
export type ConvencaoNumerica = "br" | "us" | "indeterminada";

/**
 * Convenção decimal misturada dentro do mesmo documento. É sinal de erro de
 * extração, não de documento exótico: seguir daqui significaria ler
 * `R$ 6,598.58` como R$ 6,59 em alguma linha.
 */
export class ConvencaoMistaError extends Error {
  readonly exemplos: readonly string[];

  constructor(exemplos: readonly string[]) {
    super(
      `O documento mistura as duas convenções decimais no mesmo texto ` +
        `(${exemplos.join(", ")}). Isso é erro de extração, não documento exótico: ` +
        `com convenção ambígua, todo valor acima de mil sai errado.`,
    );
    this.name = "ConvencaoMistaError";
    this.exemplos = exemplos;
  }
}

/* ------------------------------------------------------------------ *
 * Números
 * ------------------------------------------------------------------ */

/**
 * Número com pelo menos um separador. A borda direita recusa `/` e `-` para que
 * CNPJ (`12.345.678/0001-90`) e CPF não entrem na votação da convenção; a
 * esquerda deixa o sinal passar, senão um estorno não seria contado.
 */
const TOKEN_NUMERICO = /(?<![\d.,/])\d{1,3}(?:[.,]\d{3})*[.,]\d{1,3}(?![\d.,/-])/g;

/**
 * Valor monetário: o que tem centavos. Aceita o `R$` e o sinal, colados ou não,
 * inclusive o `-` à direita com que alguns extratos marcam débito. CPF e CNPJ
 * não passam por aqui: eles não têm grupo de dois dígitos no fim.
 */
const VALOR_MONETARIO = /(?<![\d.,/])(?:R\$\s*)?-?\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?![\d.,/])/g;

/**
 * A convenção de um número isolado, pela regra que vale nos dois padrões: o
 * último separador é o decimal — a não ser que ele tenha exatamente três
 * dígitos depois e seja igual aos anteriores, e aí é separador de milhar e a
 * convenção é a oposta.
 */
function convencaoDoToken(token: string): "br" | "us" | null {
  const separadores = [...token].filter((c) => c === "." || c === ",");
  if (separadores.length === 0) return null;

  const ultimo = separadores[separadores.length - 1]!;
  const cauda = token.slice(token.lastIndexOf(ultimo) + 1);

  const todosIguais = separadores.every((c) => c === ultimo);
  if (todosIguais && cauda.length === 3) {
    // Só separadores de milhar: "1.234" é brasileiro, "1,234" é americano.
    return ultimo === "." ? "br" : "us";
  }
  return ultimo === "." ? "us" : "br";
}

/**
 * Convenção do documento, por votação com exigência de unanimidade.
 *
 * Divergência entre duas linhas quaisquer levanta erro em vez de escolher a
 * maioria: um documento em que `29,90` e `29.90` convivem foi extraído errado,
 * e a maioria só esconderia isso.
 */
export function detectarConvencao(textos: readonly string[]): ConvencaoNumerica {
  const votos = new Map<"br" | "us", string>();

  for (const texto of textos) {
    for (const [token] of texto.matchAll(TOKEN_NUMERICO)) {
      const voto = convencaoDoToken(token);
      if (voto && !votos.has(voto)) votos.set(voto, token);
    }
  }

  if (votos.size === 2) throw new ConvencaoMistaError([votos.get("br")!, votos.get("us")!]);
  if (votos.has("us")) return "us";
  if (votos.has("br")) return "br";
  return "indeterminada";
}

/** Lê um número na convenção do documento. Devolve `null` no que não for número. */
export function lerValor(bruto: string, convencao: ConvencaoNumerica): number | null {
  const digitos = bruto.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digitos)) return null;

  const decimal = convencao === "us" ? "." : convencao === "br" ? "," : null;
  const corte =
    decimal === null
      ? Math.max(digitos.lastIndexOf("."), digitos.lastIndexOf(","))
      : digitos.lastIndexOf(decimal);

  let inteiro = digitos;
  let centavos = "";
  // Separador com três dígitos depois é de milhar, não decimal — em qualquer
  // convenção "1.234" e "1,234" valem mil duzentos e trinta e quatro.
  if (corte !== -1 && digitos.length - corte - 1 <= 2) {
    inteiro = digitos.slice(0, corte);
    centavos = digitos.slice(corte + 1);
  }

  const valor = Number(`${inteiro.replace(/[.,]/g, "") || "0"}.${centavos.padEnd(2, "0")}`);
  if (!Number.isFinite(valor)) return null;
  return sinalNegativo(bruto) ? -valor : valor;
}

/** Negativo escrito como `-29,90`, `(29,90)` ou `29,90-`. */
function sinalNegativo(bruto: string): boolean {
  const texto = bruto.trim();
  return /^[-(]/.test(texto) || /[-)]$/.test(texto);
}

/**
 * Valores monetários da linha, com sinal, na ordem em que aparecem.
 *
 * O sinal vem do que envolve o número: um `-` antes (mesmo separado por `R$`),
 * parênteses em volta, ou um `-` colado depois. É assim que estorno aparece.
 */
export function valoresDaLinha(texto: string, convencao: ConvencaoNumerica): number[] {
  const valores: number[] = [];

  for (const encontro of texto.matchAll(VALOR_MONETARIO)) {
    const inicio = encontro.index ?? 0;
    const fim = inicio + encontro[0].length;
    const antes = texto.slice(0, inicio);
    const depois = texto.slice(fim);

    // O sinal pode estar dentro do trecho casado ("R$ -29,90"), antes dele
    // ("-R$ 29,90", "(29,90"), ou logo depois, como em "29,90-".
    const bruto = encontro[0];
    const negativo =
      bruto.slice(0, bruto.search(/\d/)).includes("-") ||
      /-\s*(?:R\$\s*)?$/.test(antes) ||
      /\(\s*(?:R\$\s*)?$/.test(antes) ||
      /^\s*[-)]/.test(depois);

    const valor = lerValor(bruto, convencao);
    if (valor === null) continue;
    valores.push(negativo ? -Math.abs(valor) : valor);
  }

  return valores;
}

/**
 * Valores escritos numa convenção diferente da do documento.
 *
 * Sob `us` uma vírgula só pode ser separador de milhar, e sob `br` só o ponto
 * pode. Qualquer valor que quebre isso é uma linha extraída errado — e é o que
 * a sanidade semântica da camada 4 recusa.
 */
export function valoresIncompativeis(texto: string, convencao: ConvencaoNumerica): string[] {
  if (convencao === "indeterminada") return [];
  return [...texto.matchAll(TOKEN_NUMERICO)]
    .map(([token]) => token)
    .filter((token) => {
      const voto = convencaoDoToken(token);
      return voto !== null && voto !== convencao;
    });
}

/* ------------------------------------------------------------------ *
 * Datas
 * ------------------------------------------------------------------ */

const MESES: Record<string, number> = {
  jan: 1,
  fev: 2,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  set: 9,
  sep: 9,
  out: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

const MES_ALTERNATIVAS = Object.keys(MESES).join("|");

/** `04/01`, `04/01/2026`, `2026-01-04`, `20260104`, `04 JAN`, `04 de janeiro`. */
const DATA = new RegExp(
  [
    "(?<iso>\\d{4}-\\d{2}-\\d{2})",
    "(?<compacta>\\d{8})",
    "(?<numerica>\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?)",
    `(?<extensa>\\d{1,2}\\s*(?:de\\s+)?(?:${MES_ALTERNATIVAS})[a-zç]*\\.?)`,
  ].join("|"),
  "i",
);

/**
 * A data que começa a linha — é ela que caracteriza um lançamento.
 *
 * Só o começo conta, de propósito. Numa tabela de lançamentos a data é a
 * primeira coluna; numa linha de total ela aparece no meio de uma frase
 * ("TOTAL A PAGAR ATE 10/02/2026"), e ler isso como lançamento somaria de novo
 * tudo o que já está lançado. O prefixo `CAMPO=` cobre o OFX, em que a linha é
 * uma sequência de pares chave-valor.
 */
const DATA_INICIAL = new RegExp(`^\\s*(?:[A-Z][A-Z0-9_.]*=)?(?:${DATA.source})`, "i");

export type DataBruta = {
  /** Como está escrito no documento. Preservado para auditoria. */
  raw: string;
  dia: number;
  mes: number;
  /** `null` quando o documento não escreve o ano — o caso comum em fatura. */
  ano: number | null;
  /** Fim do trecho da data dentro da linha. */
  fim: number;
};

function valida(dia: number, mes: number): boolean {
  return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12;
}

/** Lê a data que começa a linha, sem resolver o ano. */
export function dataInicial(texto: string): DataBruta | null {
  const encontro = DATA_INICIAL.exec(texto);
  if (!encontro) return null;

  const grupos = encontro.groups ?? {};
  const raw = (
    grupos["iso"] ??
    grupos["compacta"] ??
    grupos["numerica"] ??
    grupos["extensa"] ??
    ""
  ).trim();
  if (!raw) return null;

  const fim = encontro.index + encontro[0].length;

  if (grupos["iso"]) {
    const [ano, mes, dia] = raw.split("-").map(Number) as [number, number, number];
    return valida(dia, mes) ? { raw, dia, mes, ano, fim } : null;
  }

  if (grupos["compacta"]) {
    const ano = Number(raw.slice(0, 4));
    const mes = Number(raw.slice(4, 6));
    const dia = Number(raw.slice(6, 8));
    return valida(dia, mes) && ano >= 1900 ? { raw, dia, mes, ano, fim } : null;
  }

  if (grupos["numerica"]) {
    const partes = raw.split(/[/.-]/).map(Number);
    const [dia, mes, anoBruto] = partes as [number, number, number | undefined];
    if (!valida(dia, mes)) return null;
    const ano = anoBruto === undefined ? null : anoBruto < 100 ? 2000 + anoBruto : anoBruto;
    return { raw, dia, mes, ano, fim };
  }

  const extensa = /^(\d{1,2})\s*(?:de\s+)?([a-zç]{3})/i.exec(raw);
  if (!extensa) return null;
  const dia = Number(extensa[1]);
  const mes = MESES[extensa[2]!.toLowerCase()] ?? 0;
  return valida(dia, mes) ? { raw, dia, mes, ano: null, fim } : null;
}

export type PeriodoReferencia = {
  /** Primeira data completa que o documento escreve. */
  inicio: string | null;
  /** Última data completa — na prática o vencimento, quando existe. */
  fim: string | null;
  /** Mês e ano de fechamento, base para resolver as datas sem ano. */
  fechamentoMes: number;
  fechamentoAno: number;
};

const DATA_COMPLETA = new RegExp(
  "(?<![\\d/-])(?:(?<iso>\\d{4}-\\d{2}-\\d{2})|(?<numerica>\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}))(?![\\d/-])",
  "g",
);

function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Período do documento, a partir das datas que ele escreve por extenso.
 *
 * A maior delas é o fechamento: numa fatura é o vencimento, e é ela que decide
 * o ano das linhas que vêm só com dia e mês. Sem nenhuma data completa, sobra a
 * data de hoje — que o chamador informa, para o resultado não depender do
 * relógio nos testes.
 */
export function detectarPeriodo(textos: readonly string[], hoje: Date): PeriodoReferencia {
  const datas: string[] = [];

  for (const texto of textos) {
    for (const encontro of texto.matchAll(DATA_COMPLETA)) {
      const grupos = encontro.groups ?? {};
      if (grupos["iso"]) {
        datas.push(grupos["iso"]);
        continue;
      }
      const partes = grupos["numerica"]!.split(/[/.-]/).map(Number);
      const [dia, mes, ano] = partes as [number, number, number];
      if (valida(dia, mes)) datas.push(iso(ano, mes, dia));
    }
  }

  datas.sort();
  const inicio = datas[0] ?? null;
  const fim = datas[datas.length - 1] ?? null;
  const base = fim ?? iso(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());

  return {
    inicio,
    fim,
    fechamentoAno: Number(base.slice(0, 4)),
    fechamentoMes: Number(base.slice(5, 7)),
  };
}

/**
 * Ano de uma data que veio só com dia e mês.
 *
 * Mês depois do fechamento é do ano anterior: numa fatura de fevereiro, `17 JUL`
 * é a parcela de uma compra do julho passado, não uma compra do futuro.
 */
export function resolverAno(mes: number, periodo: PeriodoReferencia): number {
  return mes <= periodo.fechamentoMes ? periodo.fechamentoAno : periodo.fechamentoAno - 1;
}

/* ------------------------------------------------------------------ *
 * Colunas, parcela e descrição
 * ------------------------------------------------------------------ */

/**
 * Colunas da linha. O espaçamento reconstruído pela camada 1 é o separador:
 * dois espaços ou mais são fronteira de coluna, e ` | ` cobre CSV e OFX.
 */
export function colunas(texto: string): string[] {
  return texto
    .split(/\s{2,}|\s\|\s/)
    .map((coluna) => coluna.trim())
    .filter((coluna) => coluna !== "");
}

/** A coluna é só um valor monetário? */
function ehColunaDeValor(coluna: string): boolean {
  return coluna.replace(VALOR_MONETARIO, "").replace(/[\s\-()R$]/g, "") === "";
}

export type Parcela = { numero: number; total: number };

/** `NN/NN` fora da data inicial — `05/06`, `01/12`. Não é data, é parcela. */
const PARCELA = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/g;

/**
 * Parcela na descrição.
 *
 * A busca acontece depois da data inicial, então `05/01/2026` no começo da
 * linha nunca é confundida com parcela; e o total precisa ser maior que o
 * número, o que descarta o resto das sequências parecidas.
 */
export function extrairParcela(descricao: string): Parcela | null {
  for (const [, numeroBruto, totalBruto] of descricao.matchAll(PARCELA)) {
    const numero = Number(numeroBruto);
    const total = Number(totalBruto);
    if (total > 1 && numero >= 1 && numero <= total) return { numero, total };
  }
  return null;
}

/**
 * Descritor do lançamento: a primeira coluna que sobra depois de tirar a data
 * e as colunas de valor. É essa string crua — `VIPI SUPERMERCADOS E`, e não um
 * nome "limpo" — que vira a chave do cache de merchants na camada 3.
 */
export function extrairDescricao(texto: string, data: DataBruta | null): string {
  const semData = data ? texto.slice(data.fim) : texto;
  const restantes = colunas(semData).filter((coluna) => !ehColunaDeValor(coluna));
  const bruta = restantes[0] ?? semData.trim();
  const parcela = extrairParcela(semData);
  return stripInstallmentSuffix(bruta, parcela?.numero, parcela?.total);
}

/* ------------------------------------------------------------------ *
 * Ruído e cabeçalho
 * ------------------------------------------------------------------ */

/** Rótulos genéricos de coluna, em português e inglês. Não são de emissor nenhum. */
const ROTULOS_DE_COLUNA = new Set([
  "data",
  "dt",
  "dia",
  "descricao",
  "descrição",
  "historico",
  "histórico",
  "lancamento",
  "lançamento",
  "lancamentos",
  "lançamentos",
  "valor",
  "valores",
  "credito",
  "crédito",
  "debito",
  "débito",
  "saldo",
  "cidade",
  "local",
  "documento",
  "doc",
  "parcela",
  "categoria",
  "tipo",
  "vencimento",
  "competencia",
  "competência",
  "date",
  "description",
  "amount",
  "value",
  "city",
  "balance",
]);

function ehCabecalho(texto: string): boolean {
  const partes = colunas(texto);
  if (partes.length < 2 || /\d/.test(texto)) return false;
  const rotulos = partes.filter((coluna) => ROTULOS_DE_COLUNA.has(coluna.toLowerCase()));
  return rotulos.length >= 2;
}

/** Telefone, CNPJ/CPF, URL, e-mail, paginação e frase de texto legal. */
const RUIDOS = [
  /\b0800[\s-]?\d{3}[\s-]?\d{4}\b/,
  /\(\d{2}\)\s*\d{4,5}-?\d{4}/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /[\w.-]+@[\w.-]+\.\w{2,}/,
  /p[áa]g(?:ina)?\.?\s*\d+\s*(?:de|\/)\s*\d+/i,
];

function ehRuido(texto: string): boolean {
  if (texto.trim() === "") return true;
  if (RUIDOS.some((padrao) => padrao.test(texto))) return true;
  // Frase corrida terminada em ponto, com minúsculas: texto legal de rodapé.
  const palavras = texto.trim().split(/\s+/);
  return palavras.length >= 6 && /[a-zà-ÿ]/.test(texto) && /\.\s*$/.test(texto);
}

/* ------------------------------------------------------------------ *
 * Tipagem
 * ------------------------------------------------------------------ */

export type LinhaTipada = {
  readonly id: number;
  readonly tipo: TipoLinha;
  /** Texto cru da linha, como a camada 1 entregou. */
  readonly texto: string;
  /**
   * Linha anterior de que esta é continuação — o PDF quebrou a descrição em
   * duas e o valor ficou na segunda. Quem soma e quem classifica ignora estas,
   * porque o lançamento já está contado na linha que as absorveu.
   */
  readonly absorvidaPor: number | null;
  /** Ids das linhas que completam esta. */
  readonly absorve: readonly number[];
  readonly dataRaw: string | null;
  readonly dataIso: string | null;
  readonly descricao: string | null;
  /** Valores da linha, com sinal, na ordem em que aparecem. */
  readonly valores: readonly number[];
  /** O valor do lançamento: o último da linha, que é a coluna da direita. */
  readonly valor: number | null;
  readonly estorno: boolean;
  readonly parcela: Parcela | null;
  /** Id do `MARCADOR_GRUPO` vigente — o portador, a conta, a seção. */
  readonly grupo: number | null;
};

export type DocumentoTipado = {
  readonly linhas: readonly LinhaTipada[];
  readonly convencao: ConvencaoNumerica;
  readonly periodo: PeriodoReferencia;
  readonly contagemPorTipo: Readonly<Record<TipoLinha, number>>;
};

type Fatos = {
  linha: Linha;
  data: DataBruta | null;
  valores: number[];
};

/**
 * Tipa o documento canônico.
 *
 * A ordem das regras é a da generalidade: data + valor é lançamento em qualquer
 * documento; valor sem data é total; sem valor e sem data sobram rótulo de
 * coluna, separador de bloco e rodapé. O que não couber em nenhuma vira
 * `AMBIGUA` e segue para o LLM — nunca para o lixo.
 */
export function tipar(documento: DocumentoCanonico, opcoes: { hoje?: Date } = {}): DocumentoTipado {
  const textos = documento.linhas.map((linha) => linha.texto);
  const convencao = detectarConvencao(textos);
  const periodo = detectarPeriodo(textos, opcoes.hoje ?? new Date());

  const fatos: Fatos[] = documento.linhas.map((linha) => ({
    linha,
    data: dataInicial(linha.texto),
    valores: valoresDaLinha(linha.texto, convencao),
  }));

  /**
   * A linha completa a de cima: o PDF quebrou a descrição em duas e o valor
   * ficou na segunda. Data sozinha não é lançamento — algo tem de completá-la —,
   * e o que parece data no começo da continuação costuma ser a marca de parcela
   * que desceu junto ("17 JUL INDUSTRIA DE JOIAS C" / "06/10 CHAPECO R$ 110.00").
   */
  const continuacoes = fatos.map(({ valores }, indice) => {
    const anterior = fatos[indice - 1];
    return (
      valores.length > 0 &&
      anterior !== undefined &&
      anterior.data !== null &&
      anterior.valores.length === 0
    );
  });

  const tipos: TipoLinha[] = fatos.map(({ linha, data, valores }, indice) => {
    if (continuacoes[indice]) return TipoLinha.LANCAMENTO;
    if (data && valores.length > 0) return TipoLinha.LANCAMENTO;

    // Valor sem data é total, saldo, limite ou resumo. Vale em qualquer
    // documento financeiro: lançamento tem data própria; total, não.
    if (valores.length > 0) return TipoLinha.TOTAL_DECLARADO;

    // Data sem valor: é lançamento quando a linha de baixo traz o valor que
    // falta; sozinha, não dá para dizer o que é, e quem decide é o LLM.
    if (data) return continuacoes[indice + 1] ? TipoLinha.LANCAMENTO : TipoLinha.AMBIGUA;

    const texto = linha.texto;
    if (ehCabecalho(texto)) return TipoLinha.CABECALHO;
    if (ehRuido(texto)) return TipoLinha.RUIDO;

    // Separador de bloco: rótulo curto logo acima de um lançamento ou de um
    // total — é o que introduz o portador, a conta ou a seção do resumo.
    if (texto.trim().length <= 60) {
      for (let adiante = indice + 1; adiante < Math.min(indice + 4, fatos.length); adiante += 1) {
        const proximo = fatos[adiante]!;
        if (proximo.linha.texto.trim() === "") continue;
        if (proximo.valores.length > 0) return TipoLinha.MARCADOR_GRUPO;
        break;
      }
    }

    return TipoLinha.AMBIGUA;
  });

  const linhas: LinhaTipada[] = [];
  const absorve = new Map<number, number[]>();
  let grupo: number | null = null;

  fatos.forEach(({ linha, data, valores }, indice) => {
    const tipo = tipos[indice]!;
    if (tipo === TipoLinha.MARCADOR_GRUPO) grupo = linha.id;

    if (continuacoes[indice]) {
      const dono = fatos[indice - 1]!.linha.id;
      absorve.set(dono, [...(absorve.get(dono) ?? []), linha.id]);
      linhas.push({
        id: linha.id,
        tipo,
        texto: linha.texto,
        absorvidaPor: dono,
        absorve: [],
        dataRaw: null,
        dataIso: null,
        descricao: null,
        valores,
        valor: null,
        estorno: false,
        parcela: null,
        grupo,
      });
      return;
    }

    const ehLancamento = tipo === TipoLinha.LANCAMENTO;
    const ano = data ? (data.ano ?? resolverAno(data.mes, periodo)) : null;
    // Quando a linha de baixo completa esta, o valor e o resto da descrição
    // estão lá — e é o texto das duas juntas que vale para descrição e parcela.
    const completada = continuacoes[indice + 1] === true;
    const proprios = completada ? (fatos[indice + 1]?.valores ?? []) : valores;
    const valor = ehLancamento ? (proprios[proprios.length - 1] ?? null) : null;
    const textoCompleto = completada
      ? `${linha.texto} ${fatos[indice + 1]?.linha.texto ?? ""}`
      : linha.texto;
    const descricao = ehLancamento ? extrairDescricao(textoCompleto, data) : null;

    linhas.push({
      id: linha.id,
      tipo,
      texto: linha.texto,
      absorvidaPor: null,
      absorve: [],
      dataRaw: data?.raw ?? null,
      dataIso: data && ano !== null ? iso(ano, data.mes, data.dia) : null,
      descricao,
      valores,
      valor,
      estorno: valor !== null && valor < 0,
      parcela: ehLancamento ? extrairParcela(textoCompleto.slice(data?.fim ?? 0)) : null,
      grupo,
    });
  });

  const comAbsorcao = linhas.map((linha) =>
    absorve.has(linha.id) ? { ...linha, absorve: absorve.get(linha.id)! } : linha,
  );

  const contagemPorTipo = Object.fromEntries(
    Object.values(TipoLinha).map((tipo) => [
      tipo,
      comAbsorcao.filter((linha) => linha.tipo === tipo).length,
    ]),
  ) as Record<TipoLinha, number>;

  return { linhas: comAbsorcao, convencao, periodo, contagemPorTipo };
}

/** Os lançamentos de fato: sem as linhas que só completam a de cima. */
export function lancamentos(documento: DocumentoTipado): LinhaTipada[] {
  return documento.linhas.filter(
    (linha) => linha.tipo === TipoLinha.LANCAMENTO && linha.absorvidaPor === null,
  );
}

/**
 * Pares lançamento + estorno: mesmo dia, mesmo descritor, valores opostos.
 *
 * O sinal sozinho não conta a história — na fatura de referência há um débito e
 * um crédito de R$ 29,90 de `PG *PAGTRUST TECNOLO` no mesmo 4 de janeiro, e
 * lançar os dois sem saber que se anulam é o que faz o mês fechar errado.
 */
export function paresDeEstorno(documento: DocumentoTipado): Array<[LinhaTipada, LinhaTipada]> {
  const pares: Array<[LinhaTipada, LinhaTipada]> = [];
  const pendentes = new Map<string, LinhaTipada[]>();

  const chave = (linha: LinhaTipada) =>
    `${linha.dataIso ?? ""}|${(linha.descricao ?? "").toUpperCase()}|${Math.abs(
      linha.valor ?? 0,
    ).toFixed(2)}`;

  for (const linha of lancamentos(documento)) {
    if (linha.valor === null) continue;
    const fila = pendentes.get(chave(linha)) ?? [];
    const oposto = fila.findIndex(
      (candidata) => Math.sign(candidata.valor!) !== Math.sign(linha.valor!),
    );
    if (oposto === -1) {
      pendentes.set(chave(linha), [...fila, linha]);
      continue;
    }
    const original = fila[oposto]!;
    fila.splice(oposto, 1);
    pendentes.set(chave(linha), fila);
    pares.push(linha.estorno ? [original, linha] : [linha, original]);
  }

  return pares;
}
