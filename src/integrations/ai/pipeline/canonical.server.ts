/**
 * Camada 1 — ingestão canônica.
 *
 * Qualquer entrada vira a *mesma* estrutura: uma lista de linhas numeradas.
 * Esta camada não interpreta nada. Ela numera.
 *
 * É a camada que sustenta o princípio do pipeline: como toda linha ganha um id
 * estável aqui, a completude das etapas seguintes é verificável por diferença
 * de conjuntos, e o modelo de linguagem nunca precisa transcrever conteúdo —
 * basta ele devolver ids.
 *
 * Por isso ela é *lossless* por definição: nenhuma linha é filtrada, nenhuma é
 * normalizada, e reprocessar o mesmo arquivo produz exatamente os mesmos ids.
 * Se esta camada perder algo, tudo depois está comprometido.
 */
import { createHash } from "node:crypto";

export type OrigemLinha = "pdf_texto" | "ocr" | "csv" | "ofx" | "texto";

/**
 * `[x0, y0, x1, y1]` em pontos, na origem do PDF: canto inferior esquerdo da
 * página. É o que permite recortar do PDF original a região de onde veio cada
 * número, na tela de revisão da camada 5 — sem isso, a revisão vira exercício
 * de fé. Origens sem geometria (CSV, OFX, texto colado) trazem `null`.
 */
export type Bbox = readonly [number, number, number, number];

export type Linha = {
  /** Sequencial estável, na ordem de leitura. Começa em 1. */
  readonly id: number;
  readonly pagina: number;
  readonly bbox: Bbox | null;
  /** Texto cru, com o espaçamento das colunas preservado. */
  readonly texto: string;
  readonly origem: OrigemLinha;
};

export type PaginaCanonica = {
  readonly numero: number;
  readonly largura: number;
  readonly altura: number;
};

export type MetadadosDocumento = {
  /** SHA-256 do arquivo, em hexadecimal. Identifica o documento reprocessado. */
  readonly hash: string;
  readonly nPaginas: number;
  /** Dimensões de cada página, para converter `bbox` em recorte na tela. */
  readonly paginas: readonly PaginaCanonica[];
  readonly producer: string | null;
  readonly creator: string | null;
  /** Densidade de texto extraível; é o que decide se o PDF precisa de OCR. */
  readonly caracteresPorPagina: number | null;
};

export type DocumentoCanonico = {
  readonly linhas: readonly Linha[];
  readonly metadados: MetadadosDocumento;
  readonly origem: OrigemLinha;
};

export type EntradaArquivo = {
  nome: string;
  bytes: Uint8Array;
};

export type OpcoesCanonizacao = {
  /**
   * Distância vertical, em pontos, abaixo da qual dois itens de texto contam
   * como sendo da mesma linha. Faturas alinham a coluna de valor com alguns
   * décimos de diferença em relação à descrição.
   */
  toleranciaVertical?: number;
  /**
   * Abaixo desta densidade de caracteres por página o PDF é tratado como
   * digitalizado. Fatura nativa fica na casa dos milhares; scan fica perto de
   * zero, então o limiar é folgado de propósito.
   */
  limiarCaracteresPorPagina?: number;
};

const TOLERANCIA_VERTICAL_PADRAO = 2;
const LIMIAR_CARACTERES_POR_PAGINA_PADRAO = 100;

/**
 * PDF sem camada de texto útil. O OCR ainda não existe neste pipeline, e falhar
 * aqui com o número medido é melhor que seguir com um documento vazio.
 */
export class OcrNecessarioError extends Error {
  readonly caracteresPorPagina: number;
  readonly limiar: number;

  constructor(caracteresPorPagina: number, limiar: number) {
    super(
      `O PDF tem ${caracteresPorPagina.toFixed(0)} caractere(s) extraível(is) por página, ` +
        `abaixo do limiar de ${limiar}: ele é digitalizado (imagem) e precisa de OCR, ` +
        `que ainda não está implementado nesta camada.`,
    );
    this.name = "OcrNecessarioError";
    this.caracteresPorPagina = caracteresPorPagina;
    this.limiar = limiar;
  }
}

export class ArquivoVazioError extends Error {
  constructor() {
    super("O arquivo enviado está vazio.");
    this.name = "ArquivoVazioError";
  }
}

/* ------------------------------------------------------------------ *
 * Detecção de origem
 * ------------------------------------------------------------------ */

/**
 * A extensão do arquivo é o que o usuário digitou, não o que o arquivo é.
 * A origem sai do conteúdo: assinatura do PDF, cabeçalho do OFX, e só então a
 * forma do texto.
 */
export function detectarOrigem(bytes: Uint8Array): OrigemLinha {
  const inicio = Buffer.from(bytes.slice(0, 4)).toString("latin1");
  if (inicio === "%PDF") return "pdf_texto";

  const amostra = Buffer.from(bytes.slice(0, 4096)).toString("utf8");
  if (/OFXHEADER\s*[:=]/i.test(amostra) || /<OFX>/i.test(amostra)) return "ofx";
  if (pareceDelimitado(amostra)) return "csv";
  return "texto";
}

const DELIMITADORES = [";", ",", "\t"] as const;

/** Delimitador que aparece o mesmo número de vezes em todas as linhas da amostra. */
function delimitadorDe(amostra: string): string | null {
  const linhas = amostra
    .split(/\r?\n/)
    .filter((linha) => linha.trim() !== "")
    .slice(0, 5);
  if (linhas.length < 2) return null;

  for (const delimitador of DELIMITADORES) {
    const contagens = linhas.map((linha) => linha.split(delimitador).length);
    const primeira = contagens[0]!;
    if (primeira >= 2 && contagens.every((contagem) => contagem === primeira)) {
      return delimitador;
    }
  }
  return null;
}

function pareceDelimitado(amostra: string): boolean {
  return delimitadorDe(amostra) !== null;
}

/* ------------------------------------------------------------------ *
 * Adaptador: PDF com camada de texto
 * ------------------------------------------------------------------ */

type ItemPosicionado = {
  texto: string;
  x0: number;
  /** Linha de base do texto. */
  y: number;
  largura: number;
  altura: number;
  /** Corpo da fonte, usado para estimar a largura de um espaço. */
  corpo: number;
};

/**
 * Largura aproximada de um espaço no corpo da fonte. Não vem das métricas da
 * fonte de propósito: aqui só interessa reconstruir o espaçamento das colunas,
 * e um quarto do corpo acerta isso em qualquer fonte de fatura.
 */
function larguraEspaco(corpo: number): number {
  return Math.max(corpo * 0.25, 1);
}

/**
 * Junta os itens de uma linha reconstruindo o espaçamento pela geometria.
 *
 * O pdf.js entrega cada trecho com sua posição, mas não diz quantos espaços
 * havia entre eles. Um vão maior que uma fração da largura de um espaço vira
 * tantos espaços quantos couberem — é o que mantém as colunas alinhadas, do
 * mesmo jeito que `pdftotext -layout`, e é o que deixa a linha legível para
 * quem for revisar depois. Vão perto de zero não vira espaço nenhum: é apenas
 * uma palavra que o pdf.js partiu em dois itens.
 */
function juntarItens(itens: ItemPosicionado[]): string {
  let texto = "";
  let cursor = 0;

  itens.forEach((item, indice) => {
    if (indice === 0) {
      texto = item.texto;
      cursor = item.x0 + item.largura;
      return;
    }
    const vao = item.x0 - cursor;
    const espaco = larguraEspaco(item.corpo);
    const espacos = vao < espaco * 0.3 ? 0 : Math.max(1, Math.round(vao / espaco));
    texto += " ".repeat(espacos) + item.texto;
    cursor = item.x0 + item.largura;
  });

  return texto;
}

/**
 * Agrupa itens em linhas por tolerância vertical, na ordem de leitura: de cima
 * para baixo, e da esquerda para a direita dentro de cada linha.
 */
function agruparEmLinhas(
  itens: ItemPosicionado[],
  tolerancia: number,
): Array<{ texto: string; bbox: Bbox }> {
  // A ordenação é total e determinística — o índice original desempata — para
  // que reprocessar o mesmo arquivo produza exatamente os mesmos ids.
  const ordenados = itens
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => b.item.y - a.item.y || a.item.x0 - b.item.x0 || a.indice - b.indice)
    .map(({ item }) => item);

  const grupos: ItemPosicionado[][] = [];
  let atual: ItemPosicionado[] = [];
  let ancora = Number.NaN;

  for (const item of ordenados) {
    if (atual.length === 0 || Math.abs(item.y - ancora) <= tolerancia) {
      if (atual.length === 0) ancora = item.y;
      atual.push(item);
      continue;
    }
    grupos.push(atual);
    atual = [item];
    ancora = item.y;
  }
  if (atual.length > 0) grupos.push(atual);

  return grupos.map((grupo) => {
    const emOrdem = [...grupo].sort((a, b) => a.x0 - b.x0);
    const x0 = Math.min(...emOrdem.map((item) => item.x0));
    const x1 = Math.max(...emOrdem.map((item) => item.x0 + item.largura));
    const y0 = Math.min(...emOrdem.map((item) => item.y));
    const y1 = Math.max(...emOrdem.map((item) => item.y + (item.altura || item.corpo)));
    return { texto: juntarItens(emOrdem), bbox: [x0, y0, x1, y1] as Bbox };
  });
}

type ConteudoPdf = {
  paginas: Array<{ pagina: PaginaCanonica; itens: ItemPosicionado[] }>;
  producer: string | null;
  creator: string | null;
};

async function lerPdf(bytes: Uint8Array): Promise<ConteudoPdf> {
  const { getDocumentProxy } = await import("unpdf");
  // O pdf.js recusa `Buffer` explicitamente, mesmo ele estendendo Uint8Array:
  // a cópia abaixo entrega um Uint8Array puro, que é o que ele aceita.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const info = ((await pdf.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;
  const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor : null);

  const paginas: ConteudoPdf["paginas"] = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const vista = pagina.view as number[];
    const conteudo = await pagina.getTextContent();

    const itens: ItemPosicionado[] = [];
    for (const bruto of conteudo.items) {
      if (!("str" in bruto)) continue;
      // O pdf.js insere itens de espaço só para marcar o vão entre trechos; o
      // espaçamento aqui é reconstruído pela geometria, então eles são ruído.
      if (bruto.str.trim() === "") continue;
      const transform = bruto.transform as number[];
      const corpo = Math.abs(transform[3] ?? 0) || Math.abs(transform[0] ?? 0) || bruto.height || 1;
      itens.push({
        texto: bruto.str,
        x0: transform[4] ?? 0,
        y: transform[5] ?? 0,
        largura: bruto.width,
        altura: bruto.height,
        corpo,
      });
    }

    paginas.push({
      pagina: {
        numero,
        largura: (vista[2] ?? 0) - (vista[0] ?? 0),
        altura: (vista[3] ?? 0) - (vista[1] ?? 0),
      },
      itens,
    });
  }

  return { paginas, producer: texto(info["Producer"]), creator: texto(info["Creator"]) };
}

/* ------------------------------------------------------------------ *
 * Adaptador: CSV
 * ------------------------------------------------------------------ */

/**
 * Leitura delimitada no espírito do RFC 4180: aspas protegem delimitador e
 * quebra de linha, e `""` dentro de campo entre aspas é uma aspa literal.
 *
 * Um registro pode ocupar várias linhas físicas do arquivo — por isso a leitura
 * é caractere a caractere, e não `split("\n")`.
 */
export function lerDelimitado(texto: string, delimitador: string): string[][] {
  const registros: string[][] = [];
  let campos: string[] = [];
  let campo = "";
  let entreAspas = false;

  const fecharCampo = () => {
    campos.push(campo);
    campo = "";
  };
  // Registro em branco é preservado como registro em branco: esta camada não
  // descarta linha nenhuma, e os ids precisam continuar batendo com o arquivo.
  const fecharRegistro = () => {
    fecharCampo();
    registros.push(campos);
    campos = [];
  };

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;

    if (entreAspas) {
      if (c !== '"') {
        campo += c;
      } else if (texto[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else {
        entreAspas = false;
      }
      continue;
    }

    if (c === '"' && campo === "") entreAspas = true;
    else if (c === delimitador) fecharCampo();
    else if (c === "\n") fecharRegistro();
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || campos.length > 0) fecharRegistro();

  return registros;
}

/* ------------------------------------------------------------------ *
 * Adaptador: OFX
 * ------------------------------------------------------------------ */

/** Tag SGML/XML do OFX e seu valor até o fim da linha ou o próximo `<`. */
const TAG_OFX = /<([A-Z0-9.]+)>([^<\r\n]*)/gi;

/** Campos de cabeçalho que valem virar linha: período, conta e saldo. */
const CABECALHO_OFX = ["DTSTART", "DTEND", "DTASOF", "ACCTID", "BALAMT", "CURDEF"];
/** Campos de um lançamento, na ordem em que entram no texto da linha. */
const LANCAMENTO_OFX = ["DTPOSTED", "TRNTYPE", "TRNAMT", "NAME", "MEMO", "FITID"];

function camposOfx(trecho: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const [, tag, valor] of trecho.matchAll(TAG_OFX)) {
    const chave = (tag ?? "").toUpperCase();
    const conteudo = (valor ?? "").trim();
    if (conteudo && !campos.has(chave)) campos.set(chave, conteudo);
  }
  return campos;
}

/**
 * O OFX é o caminho preferido sempre que existir: os campos já vêm separados,
 * então não há o que interpretar de posição nem de layout. Todo banco
 * brasileiro exporta OFX, e quase nenhum usuário sabe disso — vale um passo de
 * onboarding ensinando a exportar.
 *
 * Cada `STMTTRN` vira uma linha; o cabeçalho do extrato (período, conta, saldo)
 * vira linha também, para que a camada 2 tenha o período de referência e a
 * camada 4 tenha o saldo declarado.
 */
function lerOfx(texto: string): string[] {
  const linhas: string[] = [];

  const transacoes = [...texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  const cabecalho = camposOfx(texto.replace(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi, ""));

  for (const campo of CABECALHO_OFX) {
    const valor = cabecalho.get(campo);
    if (valor) linhas.push(`${campo}=${valor}`);
  }

  for (const [, corpo] of transacoes) {
    const campos = camposOfx(corpo ?? "");
    const partes = LANCAMENTO_OFX.filter((campo) => campos.has(campo)).map(
      (campo) => `${campo}=${campos.get(campo)}`,
    );
    if (partes.length > 0) linhas.push(partes.join(" | "));
  }

  return linhas;
}

/* ------------------------------------------------------------------ *
 * Canonização
 * ------------------------------------------------------------------ */

function semGeometria(textos: string[], origem: OrigemLinha): Linha[] {
  return textos.map((texto, indice) => ({
    id: indice + 1,
    pagina: 1,
    bbox: null,
    texto,
    origem,
  }));
}

/**
 * Converte o arquivo na estrutura canônica.
 *
 * A origem sai do conteúdo, não da extensão. PDF sem camada de texto levanta
 * `OcrNecessarioError` em vez de devolver um documento vazio.
 */
export async function canonizar(
  entrada: EntradaArquivo,
  opcoes: OpcoesCanonizacao = {},
): Promise<DocumentoCanonico> {
  const { bytes } = entrada;
  if (bytes.byteLength === 0) throw new ArquivoVazioError();

  const hash = createHash("sha256").update(bytes).digest("hex");
  const origem = detectarOrigem(bytes);

  if (origem === "pdf_texto") {
    const tolerancia = opcoes.toleranciaVertical ?? TOLERANCIA_VERTICAL_PADRAO;
    const limiar = opcoes.limiarCaracteresPorPagina ?? LIMIAR_CARACTERES_POR_PAGINA_PADRAO;
    const { paginas, producer, creator } = await lerPdf(bytes);

    const caracteres = paginas.reduce(
      (total, { itens }) => total + itens.reduce((soma, item) => soma + item.texto.length, 0),
      0,
    );
    const caracteresPorPagina = caracteres / Math.max(paginas.length, 1);
    if (caracteresPorPagina < limiar) throw new OcrNecessarioError(caracteresPorPagina, limiar);

    const linhas: Linha[] = [];
    for (const { pagina, itens } of paginas) {
      for (const { texto, bbox } of agruparEmLinhas(itens, tolerancia)) {
        linhas.push({ id: linhas.length + 1, pagina: pagina.numero, bbox, texto, origem });
      }
    }

    return {
      linhas,
      origem,
      metadados: {
        hash,
        nPaginas: paginas.length,
        paginas: paginas.map(({ pagina }) => pagina),
        producer,
        creator,
        caracteresPorPagina,
      },
    };
  }

  const texto = Buffer.from(bytes).toString("utf8");
  let textos: string[];
  if (origem === "ofx") {
    textos = lerOfx(texto);
  } else if (origem === "csv") {
    const delimitador = delimitadorDe(texto.slice(0, 4096)) ?? ",";
    textos = lerDelimitado(texto, delimitador).map((campos) => campos.join(" | "));
  } else {
    textos = texto.replace(/\r\n?/g, "\n").split("\n");
  }

  return {
    linhas: semGeometria(textos, origem),
    origem,
    metadados: {
      hash,
      nPaginas: 1,
      paginas: [],
      producer: null,
      creator: null,
      caracteresPorPagina: null,
    },
  };
}
