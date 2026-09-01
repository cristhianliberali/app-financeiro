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
 * esquerda deixa o sinal passar, senão um estorno não seria contado. A parte
 * inteira aceita dígitos corridos porque nem todo documento agrupa o milhar:
 * extrato OFX escreve `1200.00`, e ele vota igual.
 */
const TOKEN_NUMERICO = /(?<![\d.,/])(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{1,3}(?![\d.,/-])/g;

/**
 * Valor monetário: o que tem centavos. Aceita o `R$` e o sinal, colados ou não,
 * inclusive o `-` à direita com que alguns extratos marcam débito. CPF e CNPJ
 * não passam por aqui: eles não têm grupo de dois dígitos no fim.
 */
const VALOR_MONETARIO =
  /(?<![\d.,/])(?:R\$\s*)?-?\s*(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2}(?![\d.,/])/g;

/**
 * O voto de um número na convenção do documento, com a força da evidência.
 *
 * A regra vale nos dois padrões: o último separador é o decimal — a não ser que
 * ele tenha exatamente três dígitos depois e seja igual aos anteriores, e aí é
 * separador de milhar e a convenção é a oposta.
 *
 * A força importa tanto quanto o voto. Um valor com milhar e centavos
 * (`1.690,11`) é evidência de dinheiro; um decimal solto (`29,90`) é dinheiro
 * provável; um número só agrupado (`14.181` — pode ser lei, pode ser milhar) é
 * o indício mais fraco. E o que não tem exatamente dois dígitos de centavos —
 * `2.0` de versão, `0,5` de quantidade — não é dinheiro e **não vota**: foi um
 * "2.0" num rodapé que já derrubou a leitura de uma fatura inteira.
 */
type VotoConvencao = { voto: "br" | "us"; forca: "combo" | "decimal" | "grupos" };

function classificarToken(token: string): VotoConvencao | null {
  const separadores = [...token].filter((c) => c === "." || c === ",");
  if (separadores.length === 0) return null;

  const ultimo = separadores[separadores.length - 1]!;
  const cauda = token.slice(token.lastIndexOf(ultimo) + 1);

  const todosIguais = separadores.every((c) => c === ultimo);
  if (todosIguais && cauda.length === 3) {
    // Só separadores de milhar: "1.234" é brasileiro, "1,234" é americano.
    return { voto: ultimo === "." ? "br" : "us", forca: "grupos" };
  }
  if (cauda.length !== 2) return null;

  return {
    voto: ultimo === "." ? "us" : "br",
    forca: separadores.length > 1 ? "combo" : "decimal",
  };
}

/**
 * Contextos em que um número não diz nada sobre a convenção do documento:
 * `2,38%` é taxa de juros, e `US$ 25.90` é compra em moeda estrangeira — que
 * aparece em dólar mesmo no meio de uma fatura brasileira.
 */
function foraDoContextoMonetario(texto: string, inicio: number, fim: number): boolean {
  return (
    /(?:US?\$|USD|EUR|GBP|[€£¥])\s*$/i.test(texto.slice(0, inicio)) ||
    /^\s*%/.test(texto.slice(fim))
  );
}

function votosDe(texto: string): Array<{ token: string } & VotoConvencao> {
  const votos: Array<{ token: string } & VotoConvencao> = [];
  for (const encontro of texto.matchAll(TOKEN_NUMERICO)) {
    const inicio = encontro.index ?? 0;
    if (foraDoContextoMonetario(texto, inicio, inicio + encontro[0].length)) continue;
    const voto = classificarToken(encontro[0]);
    if (voto) votos.push({ token: encontro[0], ...voto });
  }
  return votos;
}

/**
 * Convenção do documento, por votação em que a evidência mais forte decide.
 *
 * Dois valores com milhar em convenções opostas (`1.690,11` contra `1,690.11`)
 * continuam sendo erro: isso é extração quebrada, e escolher a maioria só
 * esconderia. Já um decimal solto contra a evidência forte não derruba o
 * documento — vira alerta de sanidade na camada 4, linha a linha. E empate só
 * entre evidências fracas não decide nada nem quebra nada: sem milhar em jogo,
 * o último separador lê cada valor do jeito que está escrito.
 */
export function detectarConvencao(textos: readonly string[]): ConvencaoNumerica {
  const niveis: Record<VotoConvencao["forca"], Map<"br" | "us", string>> = {
    combo: new Map(),
    decimal: new Map(),
    grupos: new Map(),
  };

  for (const texto of textos) {
    for (const { token, voto, forca } of votosDe(texto)) {
      if (!niveis[forca].has(voto)) niveis[forca].set(voto, token);
    }
  }

  if (niveis.combo.size === 2) {
    throw new ConvencaoMistaError([niveis.combo.get("br")!, niveis.combo.get("us")!]);
  }

  for (const forca of ["combo", "decimal", "grupos"] as const) {
    const nivel = niveis[forca];
    if (nivel.size === 1) return [...nivel.keys()][0]!;
    if (nivel.size === 2) return "indeterminada";
  }
  return "indeterminada";
}

/** Lê um número na convenção do documento. Devolve `null` no que não for número. */
export function lerValor(bruto: string, convencao: ConvencaoNumerica): number | null {
  const digitos = bruto.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digitos)) return null;

  const decimal = convencao === "us" ? "." : convencao === "br" ? "," : null;
  const ultimoSeparador = Math.max(digitos.lastIndexOf("."), digitos.lastIndexOf(","));
  // Valor escrito na outra convenção — o "25.90" de uma compra em dólar numa
  // fatura brasileira — ainda é lido pelo último separador, em vez de virar
  // 2590: a convenção decide empate, não reescreve o que está no papel.
  const preferido = decimal === null ? -1 : digitos.lastIndexOf(decimal);
  const corte = preferido !== -1 ? preferido : ultimoSeparador;

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
  return votosDe(texto)
    .filter(({ voto }) => voto !== convencao)
    .map(({ token }) => token);
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
// A fronteira à direita impede pedaço de número maior de virar data: sem ela,
// "02.03" dentro do CNPJ "02.038.232/0001-64" transformava a linha do boleto
// num lançamento do valor da fatura inteira.
const DATA_INICIAL = new RegExp(`^\\s*(?:[A-Z][A-Z0-9_.]*=)?(?:${DATA.source})(?!\\d)`, "i");

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
  /** Começo do período de referência — o ciclo de compras da fatura. */
  inicio: string | null;
  /** Fim do período de referência. */
  fim: string | null;
  /** Data de vencimento declarada, quando o documento a rotula. */
  vencimento: string | null;
  /** Mês e ano de fechamento, base para resolver as datas sem ano. */
  fechamentoMes: number;
  fechamentoAno: number;
};

const DATA_COMPLETA = new RegExp(
  "(?<![\\d/-])(?:(?<iso>\\d{4}-\\d{2}-\\d{2})|(?<numerica>\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4})|" +
    `(?<extensa>\\d{1,2}\\s+(?:DE\\s+)?(?:${MES_ALTERNATIVAS})[a-zç]*\\.?\\s+(?:DE\\s+)?\\d{4}))(?![\\d/-])`,
  "gi",
);

function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Todas as datas completas do texto, numéricas ou por extenso ("11 AGO 2026"). */
function datasCompletasDe(texto: string): string[] {
  const datas: string[] = [];
  for (const encontro of texto.matchAll(DATA_COMPLETA)) {
    const grupos = encontro.groups ?? {};
    if (grupos["iso"]) {
      datas.push(grupos["iso"]);
      continue;
    }
    if (grupos["numerica"]) {
      const partes = grupos["numerica"].split(/[/.-]/).map(Number);
      const [dia, mes, ano] = partes as [number, number, number];
      if (valida(dia, mes)) datas.push(iso(ano, mes, dia));
      continue;
    }
    const extensa = /^(\d{1,2})\s+(?:DE\s+)?([a-zç]{3})[a-zç]*\.?\s+(?:DE\s+)?(\d{4})/i.exec(
      grupos["extensa"]!,
    );
    if (!extensa) continue;
    const dia = Number(extensa[1]);
    const mes = MESES[extensa[2]!.toLowerCase()] ?? 0;
    if (valida(dia, mes)) datas.push(iso(Number(extensa[3]), mes, dia));
  }
  return datas;
}

/** "REF 1 JUL A 1 AGO" — o ciclo de compras escrito só com dia e mês. */
const REFERENCIA_EXTENSA = new RegExp(
  `(\\d{1,2})\\s+(?:DE\\s+)?(${MES_ALTERNATIVAS})[a-zç]*\\.?\\s+A[TÉE]*\\s+(\\d{1,2})\\s+(?:DE\\s+)?(${MES_ALTERNATIVAS})[a-zç]*\\.?`,
  "i",
);

/** Rótulos genéricos que anunciam o ciclo de referência e o vencimento. */
const ROTULO_REFERENCIA = /\bREF\b|REFER[ÊE]NCIA|PER[ÍI]ODO/i;
const ROTULO_VENCIMENTO = /VENCIMENT/i;

/**
 * Período do documento.
 *
 * O vencimento vem da linha que o rotula ("VENCIMENTO 11 AGO 2026"), e é ele a
 * base para resolver as datas sem ano. O ciclo de compras vem da linha de
 * referência ("REF 1 JUL A 1 AGO", "Período: 01/01/2026 a 04/02/2026") — as
 * compras de uma fatura acontecem *antes* das datas administrativas que ela
 * imprime, então tratar a menor data completa como início do período marcaria
 * a fatura inteira como anômala. Sem rótulo nenhum, sobram as datas completas
 * do documento; sem nenhuma, a data de hoje, que o chamador informa.
 */
export function detectarPeriodo(textos: readonly string[], hoje: Date): PeriodoReferencia {
  const todas: string[] = [];
  let vencimento: string | null = null;

  for (const texto of textos) {
    const datas = datasCompletasDe(texto);
    todas.push(...datas);
    if (!vencimento && ROTULO_VENCIMENTO.test(texto) && datas[0]) vencimento = datas[0];
  }

  todas.sort();
  const base =
    vencimento ??
    todas[todas.length - 1] ??
    iso(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
  const fechamentoAno = Number(base.slice(0, 4));
  const fechamentoMes = Number(base.slice(5, 7));
  const fechamento = { fechamentoMes, fechamentoAno };

  let inicio: string | null = null;
  let fim: string | null = null;
  for (const texto of textos) {
    if (!ROTULO_REFERENCIA.test(texto)) continue;
    const completas = datasCompletasDe(texto);
    if (completas.length >= 2) {
      completas.sort();
      inicio = completas[0]!;
      fim = completas[completas.length - 1]!;
      break;
    }
    const extensa = REFERENCIA_EXTENSA.exec(texto);
    if (extensa) {
      const [, diaInicio, mesInicio, diaFim, mesFim] = extensa as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      const mes1 = MESES[mesInicio.toLowerCase()] ?? 0;
      const mes2 = MESES[mesFim.toLowerCase()] ?? 0;
      if (valida(Number(diaInicio), mes1) && valida(Number(diaFim), mes2)) {
        inicio = iso(resolverAno(mes1, fechamento), mes1, Number(diaInicio));
        fim = iso(resolverAno(mes2, fechamento), mes2, Number(diaFim));
        break;
      }
    }
  }

  return {
    inicio: inicio ?? todas[0] ?? null,
    fim: fim ?? todas[todas.length - 1] ?? null,
    vencimento,
    fechamentoMes,
    fechamentoAno,
  };
}

/**
 * Ano de uma data que veio só com dia e mês.
 *
 * Mês depois do fechamento é do ano anterior: numa fatura de fevereiro, `17 JUL`
 * é a parcela de uma compra do julho passado, não uma compra do futuro.
 */
export function resolverAno(
  mes: number,
  periodo: Pick<PeriodoReferencia, "fechamentoMes" | "fechamentoAno">,
): number {
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
  // Sobrou só valor? A descrição está em branco de verdade — devolver o "R$
  // 72,00" como nome seria inventar descrição a partir do número.
  const bruta = restantes[0] ?? "";
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

  /** O que a linha tem depois da data — é o que separa descrição de fragmento. */
  const conteudoAposData = (fato: Fatos): string =>
    fato.data ? fato.linha.texto.slice(fato.data.fim) : fato.linha.texto;

  /**
   * A linha completa a de cima: o PDF quebrou a descrição em duas e o valor
   * ficou na segunda ("17 JUL INDUSTRIA DE JOIAS C" / "06/10 CHAPECO R$ 110.00").
   * A linha de cima precisa ter descrição própria: um "01/02" solto — sobra de
   * parcela que a fatura imprime em linha própria — não rouba o valor da linha
   * de baixo, que é um lançamento inteiro por si.
   */
  const continuacoes = fatos.map(({ valores }, indice) => {
    const anterior = fatos[indice - 1];
    return (
      valores.length > 0 &&
      anterior !== undefined &&
      anterior.data !== null &&
      anterior.valores.length === 0 &&
      /[A-Za-zÀ-ÿ]{2}/.test(conteudoAposData(anterior))
    );
  });

  /** A linha é um lançamento por si — completo, ou completado pela de baixo. */
  const ehEntrada = (indice: number): boolean => {
    const fato = fatos[indice];
    if (!fato?.data) return false;
    if (fato.valores.length > 0) return !continuacoes[indice];
    return continuacoes[indice + 1] === true;
  };

  /**
   * Onde a descrição costuma começar depois da data, em caracteres. Fatura
   * alinha a coluna de descrição; uma linha em que o primeiro texto aparece
   * bem além desse ponto está com a descrição em branco — o nome ficou na
   * linha de cima, que é como este layout quebra lançamento comprido.
   */
  const inicios: number[] = [];
  fatos.forEach((fato, indice) => {
    if (!fato.data || fato.valores.length === 0 || continuacoes[indice]) return;
    const posicao = /\S/.exec(conteudoAposData(fato))?.index;
    if (posicao !== undefined) inicios.push(posicao);
  });
  const frequencia = new Map<number, number>();
  for (const posicao of inicios) {
    const faixa = Math.round(posicao / 4);
    frequencia.set(faixa, (frequencia.get(faixa) ?? 0) + 1);
  }
  const faixaModal = [...frequencia.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const inicioTipico = faixaModal * 4;

  const faltaDescricao = (indice: number): boolean => {
    const fato = fatos[indice]!;
    if (!fato.data) return false;
    const corpo = continuacoes[indice + 1]
      ? `${conteudoAposData(fato)} ${fatos[indice + 1]?.linha.texto ?? ""}`
      : conteudoAposData(fato);
    const restantes = colunas(corpo).filter((coluna) => !ehColunaDeValor(coluna));
    if (restantes.length === 0) return true;
    if (inicios.length < 6 || fato.valores.length === 0) return false;
    const posicao = /\S/.exec(conteudoAposData(fato))?.index ?? 0;
    return posicao - inicioTipico > 12;
  };

  /* Reivindicações: cada pedaço de lançamento encontra o seu dono. */
  const donoDe = new Map<number, number>();
  const nomesDe = new Map<number, number[]>();
  const caudasDe = new Map<number, number[]>();

  const podeSerNome = (indice: number): boolean => {
    const fato = fatos[indice];
    if (!fato || donoDe.has(indice)) return false;
    if (fato.data || fato.valores.length > 0) return false;
    const texto = fato.linha.texto.trim();
    return (
      texto !== "" &&
      texto.length <= 45 &&
      !texto.endsWith(":") &&
      !ehCabecalho(fato.linha.texto) &&
      !ehRuido(fato.linha.texto)
    );
  };

  /** "PROTEÇÃO PERDA OU" pede a linha de baixo: nome quebrado no conectivo. */
  const CONECTIVO_FINAL = /\b(?:DE|DA|DO|DAS|DOS|E|OU|COM|PARA|POR|NO|NA|NOS|NAS)\s*$/i;
  /** Sobra de parcela em linha própria: "(5249) 03/12", "01/02". */
  const FRAGMENTO_DE_CAUDA = /^\(?\d{3,4}\)?\s*\d{1,2}\s*\/\s*\d{1,2}$|^\d{1,2}\s*\/\s*\d{1,2}$/;

  fatos.forEach((fato, indice) => {
    if (!ehEntrada(indice)) return;

    if (faltaDescricao(indice)) {
      const nomes: number[] = [];
      if (podeSerNome(indice - 1)) {
        nomes.unshift(indice - 1);
        if (
          podeSerNome(indice - 2) &&
          CONECTIVO_FINAL.test(fatos[indice - 2]!.linha.texto.trim())
        ) {
          nomes.unshift(indice - 2);
        }
      }
      if (nomes.length > 0) {
        for (const nome of nomes) donoDe.set(nome, indice);
        nomesDe.set(indice, nomes);
      }
    }

    const fimDaEntrada = continuacoes[indice + 1] ? indice + 1 : indice;
    const cauda = fimDaEntrada + 1;
    const fatoCauda = fatos[cauda];
    if (
      fatoCauda &&
      !donoDe.has(cauda) &&
      fatoCauda.valores.length === 0 &&
      FRAGMENTO_DE_CAUDA.test(fatoCauda.linha.texto.trim())
    ) {
      donoDe.set(cauda, indice);
      caudasDe.set(indice, [cauda]);
    }
  });

  const tipos: TipoLinha[] = fatos.map(({ linha, data, valores }, indice) => {
    // Pedaço de lançamento — continuação, nome ou cauda — é lançamento.
    if (continuacoes[indice] || donoDe.has(indice)) return TipoLinha.LANCAMENTO;
    if (ehEntrada(indice)) return TipoLinha.LANCAMENTO;

    // Valor sem data é total, saldo, limite ou resumo. Vale em qualquer
    // documento financeiro: lançamento tem data própria; total, não.
    if (valores.length > 0) return TipoLinha.TOTAL_DECLARADO;

    // Data sem valor e sem dono: sobra que nenhuma regra reclamou. LLM decide.
    if (data) return TipoLinha.AMBIGUA;

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
  const absorvidasPorDono = new Map<number, number[]>();
  let grupo: number | null = null;

  fatos.forEach(({ linha, data, valores }, indice) => {
    const tipo = tipos[indice]!;
    if (tipo === TipoLinha.MARCADOR_GRUPO) grupo = linha.id;

    const donoIndice = continuacoes[indice] ? indice - 1 : donoDe.get(indice);
    if (donoIndice !== undefined) {
      const dono = fatos[donoIndice]!.linha.id;
      absorvidasPorDono.set(dono, [...(absorvidasPorDono.get(dono) ?? []), linha.id]);
      linhas.push({
        id: linha.id,
        tipo: TipoLinha.LANCAMENTO,
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

    if (!ehLancamento || !data) {
      linhas.push({
        id: linha.id,
        tipo,
        texto: linha.texto,
        absorvidaPor: null,
        absorve: [],
        dataRaw: data?.raw ?? null,
        dataIso: data && ano !== null ? iso(ano, data.mes, data.dia) : null,
        descricao: null,
        valores,
        valor: null,
        estorno: false,
        parcela: null,
        grupo,
      });
      return;
    }

    // O lançamento inteiro: nome absorvido de cima, corpo (com a continuação
    // de valor, quando houver) e cauda de parcela. Descrição e parcela saem
    // desse conjunto; o valor, da linha que o carrega.
    const nomes = (nomesDe.get(indice) ?? []).map((nome) => fatos[nome]!.linha.texto.trim());
    const caudas = (caudasDe.get(indice) ?? []).map((cauda) => fatos[cauda]!.linha.texto.trim());
    const completada = continuacoes[indice + 1] === true;
    const corpo = completada
      ? `${linha.texto} ${fatos[indice + 1]?.linha.texto ?? ""}`
      : linha.texto;
    const proprios = completada ? (fatos[indice + 1]?.valores ?? []) : valores;
    const valor = proprios[proprios.length - 1] ?? null;

    const parcela = extrairParcela([corpo.slice(data.fim), ...caudas].join(" "));
    const descricaoBase = nomes.length > 0 ? nomes.join(" ") : extrairDescricao(corpo, data);
    const descricao = stripInstallmentSuffix(descricaoBase, parcela?.numero, parcela?.total);

    linhas.push({
      id: linha.id,
      tipo,
      texto: linha.texto,
      absorvidaPor: null,
      absorve: [],
      dataRaw: data.raw,
      dataIso: ano !== null ? iso(ano, data.mes, data.dia) : null,
      descricao,
      valores,
      valor,
      estorno: valor !== null && valor < 0,
      parcela,
      grupo,
    });
  });

  const comAbsorcao = linhas.map((linha) =>
    absorvidasPorDono.has(linha.id)
      ? { ...linha, absorve: absorvidasPorDono.get(linha.id)!.sort((a, b) => a - b) }
      : linha,
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
