/**
 * Camada 3 — classificação por LLM em blocos.
 *
 * O modelo recebe linhas já numeradas pela camada 1 e devolve **apenas
 * decisões**: `id:tipo,categoria,confiança`. Ele não tem canal de saída por
 * onde emitir um valor, uma data ou uma descrição — alucinação de número não é
 * mitigada aqui, ela é impossível.
 *
 * Completude é garantida por construção, não por conferência posterior: cada
 * bloco declara quantas decisões espera, e o que falta volta a ser perguntado
 * isoladamente. Nenhum caminho de código deixa o pipeline seguir com id sem
 * decisão.
 */
import { dividirEmBlocos, emParalelo, type Bloco } from "./blocks";
import { chaveMerchant, type CacheMerchants } from "./merchants.server";
import type { LlmClient, PedidoLlm } from "./provider.server";
import { TipoLinha, type DocumentoTipado, type LinhaTipada } from "./typing";

export type Categoria = {
  /** Código curto usado no protocolo — é o que o modelo escreve de volta. */
  codigo: string;
  nome: string;
  descricao: string | null;
};

const CODIGO_PARA_TIPO: Record<string, TipoLinha> = {
  L: TipoLinha.LANCAMENTO,
  T: TipoLinha.TOTAL_DECLARADO,
  C: TipoLinha.CABECALHO,
  G: TipoLinha.MARCADOR_GRUPO,
  R: TipoLinha.RUIDO,
};

export type Decisao = {
  readonly id: number;
  readonly tipo: TipoLinha;
  /** `null` quando a linha não é lançamento, ou quando o código veio errado. */
  readonly categoria: string | null;
  readonly confianca: number;
  readonly origem: "llm" | "cache";
};

export type ResultadoClassificacao = {
  readonly decisoes: readonly Decisao[];
  /** Ids julgados nos dois lados de uma fronteira cujas decisões não bateram. */
  readonly divergencias: readonly number[];
  /** Ids em que o modelo contradisse a tipagem determinística da camada 2. */
  readonly conflitosDeTipo: readonly number[];
  /** Ids que o modelo inventou — descartados, e registrados como sinal de qualidade. */
  readonly extras: readonly number[];
  /** Códigos de categoria fora do enum oferecido. */
  readonly categoriasDesconhecidas: readonly string[];
  readonly chamadas: number;
  /** Decisões que vieram do cache de merchants, sem custo de requisição. */
  readonly doCache: number;
};

/**
 * Ids que continuaram sem decisão depois das tentativas cirúrgicas. É erro, e
 * não aviso: seguir daqui significaria gravar um documento incompleto.
 */
export class ClassificacaoIncompletaError extends Error {
  readonly faltando: readonly number[];

  constructor(faltando: readonly number[]) {
    super(
      `${faltando.length} linha(s) ficaram sem decisão depois das tentativas de ` +
        `recuperação (ids ${faltando.join(", ")}). O pipeline não avança incompleto.`,
    );
    this.name = "ClassificacaoIncompletaError";
    this.faltando = faltando;
  }
}

export type OpcoesClassificacao = {
  tamanhoBloco?: number;
  sobreposicao?: number;
  concorrencia?: number;
  /** Tentativas de recuperação por bloco, além da chamada original. */
  tentativas?: number;
};

/* ------------------------------------------------------------------ *
 * Protocolo
 * ------------------------------------------------------------------ */

/** `40:L,GAS,0.95` — tolerante a espaços, estrito quanto ao formato. */
const DECISAO = /^\s*(\d+)\s*:\s*([A-Za-z]+)\s*,\s*([^,\s]+)\s*,\s*(\d*\.?\d+)\s*$/;

type DecisaoBruta = {
  id: number;
  tipo: TipoLinha;
  categoria: string | null;
  confianca: number;
};

/**
 * Lê a resposta do modelo.
 *
 * Linha que não casa com o formato é simplesmente ignorada — vira `faltando`, e
 * o id volta a ser perguntado. É de propósito: um "Claro, aqui estão as
 * decisões:" no meio da resposta não pode derrubar o bloco inteiro.
 */
export function lerDecisoes(
  resposta: string,
  categoriasValidas: ReadonlySet<string>,
): { decisoes: DecisaoBruta[]; categoriasDesconhecidas: string[] } {
  const decisoes: DecisaoBruta[] = [];
  const categoriasDesconhecidas: string[] = [];

  for (const linha of resposta.split("\n")) {
    const encontro = DECISAO.exec(linha);
    if (!encontro) continue;

    const [, idBruto, tipoBruto, categoriaBruta, confiancaBruta] = encontro as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    const tipo = CODIGO_PARA_TIPO[tipoBruto.toUpperCase()];
    if (!tipo) continue;

    const codigo = categoriaBruta.toUpperCase();
    const semCategoria = codigo === "-" || codigo === "NA";
    const conhecida = categoriasValidas.has(codigo);
    if (!semCategoria && !conhecida) categoriasDesconhecidas.push(categoriaBruta);

    const confianca = Number(confiancaBruta);
    decisoes.push({
      id: Number(idBruto),
      tipo,
      categoria: conhecida ? codigo : null,
      // Categoria fora do enum não derruba a decisão, mas zera a confiança: a
      // linha segue para a quarentena da camada 5 em vez de entrar no banco.
      confianca: !Number.isFinite(confianca)
        ? 0
        : Math.min(Math.max(confianca, 0), 1) * (semCategoria || conhecida ? 1 : 0),
    });
  }

  return { decisoes, categoriasDesconhecidas };
}

function listaDeCategorias(categorias: readonly Categoria[]): string {
  if (categorias.length === 0) return "- OUTROS: qualquer lançamento";
  return categorias
    .map(({ codigo, nome, descricao }) =>
      descricao?.trim() ? `- ${codigo} (${nome}): ${descricao.trim()}` : `- ${codigo} (${nome})`,
    )
    .join("\n");
}

/**
 * O prompt do sistema é fixo por documento, então entra no cache de prompt do
 * provedor e sai de graça a partir do segundo bloco.
 */
export function promptDoSistema(categorias: readonly Categoria[]): string {
  return [
    "Você classifica linhas de documentos financeiros. Você NÃO transcreve nada:",
    "não devolva valores, datas, descrições nem qualquer texto do documento.",
    "",
    "Para cada linha numerada, devolva exatamente uma decisão, uma por linha:",
    "id:tipo,categoria,confianca",
    "",
    "tipo:",
    "  L = lançamento (uma compra, um pagamento, um movimento)",
    "  T = total, saldo, limite ou linha de resumo",
    "  C = cabeçalho de coluna",
    "  G = separador de bloco (portador, conta, seção)",
    "  R = ruído (rodapé, telefone, texto legal)",
    "",
    "categoria: um dos códigos abaixo quando tipo=L; use - nos demais tipos.",
    listaDeCategorias(categorias),
    "",
    "confianca: número entre 0 e 1, com ponto decimal.",
    "",
    "Responda só com essas linhas. Sem JSON, sem comentários, sem texto em volta.",
    "Não invente ids: use apenas os que aparecem no pedido.",
  ].join("\n");
}

function promptDoUsuario(ids: readonly number[], textoPorId: ReadonlyMap<number, string>): string {
  const linhas = ids.map((id) => `${id}: ${textoPorId.get(id) ?? ""}`);
  return [
    `${ids.length} linha(s), ids ${ids[0]} a ${ids[ids.length - 1]}.`,
    `Retorne exatamente ${ids.length} decisões, uma para cada id abaixo.`,
    "",
    ...linhas,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Classificação
 * ------------------------------------------------------------------ */

/** O texto do lançamento, com as linhas que o completam já juntas. */
function textoDe(linha: LinhaTipada, porId: ReadonlyMap<number, LinhaTipada>): string {
  const partes = [linha.texto, ...linha.absorve.map((id) => porId.get(id)?.texto ?? "")];
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

/** As linhas que precisam de decisão: lançamento (categoria) e ambígua (tipo). */
export function candidatos(documento: DocumentoTipado): LinhaTipada[] {
  return documento.linhas.filter(
    (linha) =>
      linha.absorvidaPor === null &&
      (linha.tipo === TipoLinha.LANCAMENTO || linha.tipo === TipoLinha.AMBIGUA),
  );
}

type EstadoBloco = {
  decisoes: DecisaoBruta[];
  extras: number[];
  categoriasDesconhecidas: string[];
  chamadas: number;
  faltando: number[];
};

async function classificarBloco(input: {
  ids: readonly number[];
  textoPorId: ReadonlyMap<number, string>;
  cliente: LlmClient;
  sistema: string;
  categoriasValidas: ReadonlySet<string>;
  tentativas: number;
}): Promise<EstadoBloco> {
  const estado: EstadoBloco = {
    decisoes: [],
    extras: [],
    categoriasDesconhecidas: [],
    chamadas: 0,
    faltando: [],
  };

  const perguntar = async (ids: readonly number[]): Promise<void> => {
    const pedido: PedidoLlm = {
      sistema: input.sistema,
      usuario: promptDoUsuario(ids, input.textoPorId),
    };
    estado.chamadas += 1;
    const resposta = await input.cliente.completar(pedido);
    const { decisoes, categoriasDesconhecidas } = lerDecisoes(resposta, input.categoriasValidas);

    const enviados = new Set(ids);
    const jaVistos = new Set(estado.decisoes.map((decisao) => decisao.id));
    for (const decisao of decisoes) {
      // Diferença de conjuntos nos dois sentidos: o que o modelo inventou é
      // descartado aqui, e o que ele deixou de responder cai em `faltando`.
      if (!enviados.has(decisao.id)) {
        estado.extras.push(decisao.id);
        continue;
      }
      if (jaVistos.has(decisao.id)) continue;
      jaVistos.add(decisao.id);
      estado.decisoes.push(decisao);
    }
    estado.categoriasDesconhecidas.push(...categoriasDesconhecidas);
  };

  await perguntar(input.ids);

  const respondidos = () => new Set(estado.decisoes.map((decisao) => decisao.id));
  let faltando = input.ids.filter((id) => !respondidos().has(id));

  for (let tentativa = 1; tentativa <= input.tentativas && faltando.length > 0; tentativa += 1) {
    // Só os ids faltantes, nunca o bloco inteiro. Na última tentativa cada um
    // vai sozinho — é a pergunta mais curta que existe, e a que o modelo acerta.
    const lotes = tentativa < input.tentativas ? [faltando] : faltando.map((id) => [id]);
    for (const lote of lotes) await perguntar(lote);
    faltando = input.ids.filter((id) => !respondidos().has(id));
  }

  estado.faltando = faltando;
  return estado;
}

/**
 * Classifica o documento tipado.
 *
 * O cache de merchants é consultado **antes** de montar os blocos: só descritor
 * inédito entra numa chamada. O que sobra é dividido em blocos independentes,
 * rodados em paralelo, cada um com seu contrato de contagem.
 */
export async function classificar(input: {
  documento: DocumentoTipado;
  categorias: readonly Categoria[];
  cliente: LlmClient;
  cache?: CacheMerchants;
  opcoes?: OpcoesClassificacao;
}): Promise<ResultadoClassificacao> {
  const { documento, categorias, cliente, cache } = input;
  const opcoes = input.opcoes ?? {};
  const tentativas = opcoes.tentativas ?? 2;

  const porId = new Map(documento.linhas.map((linha) => [linha.id, linha]));
  const pendentes = candidatos(documento);
  const textoPorId = new Map(pendentes.map((linha) => [linha.id, textoDe(linha, porId)]));

  // Cache antes dos blocos: merchant já conhecido não vira token pago.
  const decisoes: Decisao[] = [];
  const paraOModelo: LinhaTipada[] = [];
  for (const linha of pendentes) {
    const descritor = linha.tipo === TipoLinha.LANCAMENTO ? linha.descricao : null;
    const rotulo = descritor && cache ? await cache.buscar(descritor) : null;
    if (rotulo) {
      decisoes.push({
        id: linha.id,
        tipo: TipoLinha.LANCAMENTO,
        categoria: rotulo.categoria,
        confianca: rotulo.confianca,
        origem: "cache",
      });
      continue;
    }
    paraOModelo.push(linha);
  }
  const doCache = decisoes.length;

  const categoriasValidas = new Set(categorias.map(({ codigo }) => codigo.toUpperCase()));
  const sistema = promptDoSistema(categorias);
  const blocos = dividirEmBlocos(
    paraOModelo.map((linha) => linha.id),
    opcoes.tamanhoBloco,
    opcoes.sobreposicao,
  );

  const estados = await emParalelo(blocos, opcoes.concorrencia ?? 4, (bloco: Bloco) =>
    classificarBloco({
      ids: bloco.ids,
      textoPorId,
      cliente,
      sistema,
      categoriasValidas,
      tentativas,
    }),
  );

  const faltando = estados.flatMap((estado) => estado.faltando);
  if (faltando.length > 0) throw new ClassificacaoIncompletaError([...new Set(faltando)].sort());

  // Cada linha de fronteira foi julgada duas vezes. Divergência não escolhe
  // vencedor: fica a primeira decisão, e o id vai para revisão na camada 5.
  const porLinha = new Map<number, DecisaoBruta>();
  const divergencias = new Set<number>();
  for (const estado of estados) {
    for (const decisao of estado.decisoes) {
      const anterior = porLinha.get(decisao.id);
      if (!anterior) {
        porLinha.set(decisao.id, decisao);
        continue;
      }
      if (anterior.tipo !== decisao.tipo || anterior.categoria !== decisao.categoria) {
        divergencias.add(decisao.id);
      }
    }
  }

  const conflitosDeTipo: number[] = [];
  for (const [id, decisao] of porLinha) {
    const linha = porId.get(id)!;
    if (linha.tipo !== TipoLinha.AMBIGUA && linha.tipo !== decisao.tipo) conflitosDeTipo.push(id);
    decisoes.push({ ...decisao, origem: "llm" });

    // Só merchant de lançamento entra no cache, e só quando a decisão foi
    // limpa: nada de gravar uma divergência de fronteira como se fosse rótulo.
    if (
      cache &&
      decisao.tipo === TipoLinha.LANCAMENTO &&
      decisao.categoria !== null &&
      linha.descricao &&
      !divergencias.has(id)
    ) {
      await cache.gravar(chaveMerchant(linha.descricao), {
        categoria: decisao.categoria,
        confianca: decisao.confianca,
      });
    }
  }

  decisoes.sort((a, b) => a.id - b.id);

  return {
    decisoes,
    divergencias: [...divergencias].sort((a, b) => a - b),
    conflitosDeTipo: conflitosDeTipo.sort((a, b) => a - b),
    extras: [...new Set(estados.flatMap((estado) => estado.extras))].sort((a, b) => a - b),
    categoriasDesconhecidas: [
      ...new Set(estados.flatMap((estado) => estado.categoriasDesconhecidas)),
    ],
    chamadas: estados.reduce((total, estado) => total + estado.chamadas, 0),
    doCache,
  };
}
