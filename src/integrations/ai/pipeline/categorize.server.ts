/**
 * Etapa 2 da importação — categorização por IA.
 *
 * Só decisões atravessam a fronteira: o modelo recebe descritores numerados e
 * a lista de categorias, e devolve `id:codigo,confiança`. Nenhum arquivo,
 * nenhum valor transcrito, nenhuma data — quem carrega os dados continua sendo
 * o parser da etapa 1, e a resposta do modelo não tem canal por onde mudar um
 * número.
 *
 * O mesmo contrato de contagem da camada 3 vale aqui: cada bloco declara
 * quantas decisões espera, o que falta volta a ser perguntado sozinho, e id
 * inventado é descartado. Gasto e entrada são rodadas separadas, cada uma com
 * o próprio enum de categorias — assim uma compra nunca recebe categoria de
 * receita, por construção.
 */
import { dividirEmBlocos, emParalelo } from "./blocks";
import { chaveMerchant, type CacheMerchants } from "./merchants.server";
import type { LlmClient, PedidoLlm } from "./provider.server";
import { ClassificacaoIncompletaError, type OpcoesClassificacao } from "./classify.server";

export type ItemParaCategorizar = {
  /** Id da linha no documento canônico — só ele volta do modelo. */
  id: number;
  /** Descritor cru do lançamento, como o parser extraiu. */
  descricao: string;
  /** Valor absoluto, só como contexto no prompt. */
  valor: number;
  kind: "income" | "expense";
};

export type CategoriaDisponivel = {
  /** Código curto do protocolo — o que o modelo escreve de volta. */
  codigo: string;
  nome: string;
  descricao: string | null;
  kind: "income" | "expense";
};

export type DecisaoDeCategoria = {
  readonly id: number;
  /** Código da categoria escolhida; `null` quando nenhuma serviu. */
  readonly codigo: string | null;
  readonly confianca: number;
  readonly origem: "cache" | "ia";
};

export type ResultadoCategorizacao = {
  readonly decisoes: readonly DecisaoDeCategoria[];
  readonly chamadas: number;
  readonly doCache: number;
  /** Códigos fora do enum oferecido — sinal de qualidade do modelo. */
  readonly codigosDesconhecidos: readonly string[];
};

/** `40:MERC,0.95` ou `41:-,0.4` — tolerante a espaços, estrito no formato. */
const DECISAO = /^\s*(\d+)\s*:\s*([^,\s]+)\s*,\s*(\d*\.?\d+)\s*$/;

export function lerDecisoesDeCategoria(
  resposta: string,
  codigosValidos: ReadonlySet<string>,
): {
  decisoes: Array<{ id: number; codigo: string | null; confianca: number }>;
  desconhecidos: string[];
} {
  const decisoes: Array<{ id: number; codigo: string | null; confianca: number }> = [];
  const desconhecidos: string[] = [];

  for (const linha of resposta.split("\n")) {
    const encontro = DECISAO.exec(linha);
    if (!encontro) continue;
    const [, idBruto, codigoBruto, confiancaBruta] = encontro as unknown as [
      string,
      string,
      string,
      string,
    ];

    const codigo = codigoBruto.toUpperCase();
    const nenhuma = codigo === "-" || codigo === "NA";
    const conhecida = codigosValidos.has(codigo);
    if (!nenhuma && !conhecida) desconhecidos.push(codigoBruto);

    const confianca = Number(confiancaBruta);
    decisoes.push({
      id: Number(idBruto),
      codigo: conhecida ? codigo : null,
      // Código fora do enum não derruba a decisão, mas zera a confiança: a
      // linha fica sem categoria na tela, para o usuário escolher.
      confianca: !Number.isFinite(confianca)
        ? 0
        : Math.min(Math.max(confianca, 0), 1) * (nenhuma || conhecida ? 1 : 0),
    });
  }

  return { decisoes, desconhecidos };
}

function promptDoSistema(categorias: readonly CategoriaDisponivel[], kind: "income" | "expense") {
  const lista = categorias
    .map(({ codigo, nome, descricao }) =>
      descricao?.trim() ? `- ${codigo} (${nome}): ${descricao.trim()}` : `- ${codigo} (${nome})`,
    )
    .join("\n");

  return [
    "Você escolhe a categoria de lançamentos financeiros brasileiros.",
    "Você NÃO transcreve nada: não devolva valores, datas nem descrições.",
    "",
    "Para cada linha numerada, devolva exatamente uma decisão, uma por linha:",
    "id:codigo,confianca",
    "",
    kind === "expense"
      ? "Todas as linhas são gastos. Códigos de categoria disponíveis:"
      : "Todas as linhas são entradas (créditos e recebimentos). Códigos disponíveis:",
    lista,
    "",
    "Use - quando nenhuma categoria servir. confianca: número entre 0 e 1.",
    "A descrição de cada categoria traz palavras-chave que costumam aparecer",
    "na fatura; use-as para decidir.",
    "",
    "Responda só com essas linhas. Sem JSON, sem comentários, sem texto em volta.",
    "Não invente ids: use apenas os que aparecem no pedido.",
  ].join("\n");
}

function promptDoUsuario(itens: readonly ItemParaCategorizar[]): string {
  const linhas = itens.map(
    (item) => `${item.id}: ${item.descricao}  |  R$ ${item.valor.toFixed(2)}`,
  );
  return [
    `${itens.length} linha(s). Retorne exatamente ${itens.length} decisões, uma para cada id.`,
    "",
    ...linhas,
  ].join("\n");
}

async function categorizarRodada(input: {
  itens: readonly ItemParaCategorizar[];
  categorias: readonly CategoriaDisponivel[];
  kind: "income" | "expense";
  cliente: LlmClient;
  cache: CacheMerchants | undefined;
  opcoes: OpcoesClassificacao;
}): Promise<{
  decisoes: DecisaoDeCategoria[];
  chamadas: number;
  doCache: number;
  desconhecidos: string[];
}> {
  const { itens, categorias, kind, cliente, cache } = input;
  const decisoes: DecisaoDeCategoria[] = [];
  const desconhecidos: string[] = [];
  let chamadas = 0;

  // O cache guarda o NOME da categoria (estável entre perfis e importações);
  // o código só existe dentro desta requisição. Cache que aponta para uma
  // categoria que este perfil não tem é tratado como ausência.
  const codigoPorNome = new Map(
    categorias.map((categoria) => [categoria.nome.toLowerCase(), categoria.codigo]),
  );

  const paraOModelo: ItemParaCategorizar[] = [];
  for (const item of itens) {
    const rotulo = cache ? await cache.buscar(chaveMerchant(item.descricao)) : null;
    const codigo = rotulo ? codigoPorNome.get(rotulo.categoria.toLowerCase()) : undefined;
    if (rotulo && codigo) {
      decisoes.push({ id: item.id, codigo, confianca: rotulo.confianca, origem: "cache" });
      continue;
    }
    paraOModelo.push(item);
  }
  const doCache = decisoes.length;

  const porId = new Map(paraOModelo.map((item) => [item.id, item]));
  const codigosValidos = new Set(categorias.map(({ codigo }) => codigo.toUpperCase()));
  const sistema = promptDoSistema(categorias, kind);
  const tentativas = input.opcoes.tentativas ?? 2;

  const blocos = dividirEmBlocos(
    paraOModelo.map((item) => item.id),
    input.opcoes.tamanhoBloco,
    input.opcoes.sobreposicao ?? 0,
  );

  const porBloco = await emParalelo(blocos, input.opcoes.concorrencia ?? 4, async (bloco) => {
    const proprias: Array<{ id: number; codigo: string | null; confianca: number }> = [];
    const vistos = new Set<number>();

    const perguntar = async (ids: readonly number[]): Promise<void> => {
      const pedido: PedidoLlm = {
        sistema,
        usuario: promptDoUsuario(ids.map((id) => porId.get(id)!)),
      };
      chamadas += 1;
      const resposta = await cliente.completar(pedido);
      const lidas = lerDecisoesDeCategoria(resposta, codigosValidos);
      desconhecidos.push(...lidas.desconhecidos);

      const enviados = new Set(ids);
      for (const decisao of lidas.decisoes) {
        // Diferença de conjuntos: id inventado é descartado; o que faltar
        // volta a ser perguntado sozinho.
        if (!enviados.has(decisao.id) || vistos.has(decisao.id)) continue;
        vistos.add(decisao.id);
        proprias.push(decisao);
      }
    };

    await perguntar(bloco.ids);
    let faltando = bloco.ids.filter((id) => !vistos.has(id));
    for (let tentativa = 1; tentativa <= tentativas && faltando.length > 0; tentativa += 1) {
      const lotes = tentativa < tentativas ? [faltando] : faltando.map((id) => [id]);
      for (const lote of lotes) await perguntar(lote);
      faltando = bloco.ids.filter((id) => !vistos.has(id));
    }
    return { proprias, faltando };
  });

  const faltando = [...new Set(porBloco.flatMap((bloco) => bloco.faltando))];
  if (faltando.length > 0) throw new ClassificacaoIncompletaError(faltando.sort((a, b) => a - b));

  const nomePorCodigo = new Map(categorias.map((categoria) => [categoria.codigo, categoria.nome]));
  for (const bloco of porBloco) {
    for (const decisao of bloco.proprias) {
      decisoes.push({ ...decisao, origem: "ia" });
      const item = porId.get(decisao.id)!;
      // Decisão com categoria vira rótulo para a próxima importação.
      if (cache && decisao.codigo) {
        await cache.gravar(chaveMerchant(item.descricao), {
          categoria: nomePorCodigo.get(decisao.codigo) ?? decisao.codigo,
          confianca: decisao.confianca,
        });
      }
    }
  }

  return { decisoes, chamadas, doCache, desconhecidos };
}

/**
 * Categoriza os lançamentos extraídos na etapa 1.
 *
 * Gasto e entrada rodam separados, cada um só com as categorias do próprio
 * tipo: uma compra não tem como receber categoria de receita, porque o código
 * dela nem está no enum daquela rodada.
 */
export async function categorizarTransacoes(input: {
  itens: readonly ItemParaCategorizar[];
  categorias: readonly CategoriaDisponivel[];
  cliente: LlmClient;
  cache?: CacheMerchants;
  opcoes?: OpcoesClassificacao;
}): Promise<ResultadoCategorizacao> {
  const opcoes = input.opcoes ?? {};
  const rodadas = (["expense", "income"] as const).map((kind) => ({
    kind,
    itens: input.itens.filter((item) => item.kind === kind),
    categorias: input.categorias.filter((categoria) => categoria.kind === kind),
  }));

  const resultados = [];
  for (const rodada of rodadas) {
    if (rodada.itens.length === 0) continue;
    resultados.push(
      await categorizarRodada({
        itens: rodada.itens,
        categorias: rodada.categorias,
        kind: rodada.kind,
        cliente: input.cliente,
        cache: input.cache,
        opcoes,
      }),
    );
  }

  const decisoes = resultados.flatMap((resultado) => resultado.decisoes);
  decisoes.sort((a, b) => a.id - b.id);
  return {
    decisoes,
    chamadas: resultados.reduce((total, resultado) => total + resultado.chamadas, 0),
    doCache: resultados.reduce((total, resultado) => total + resultado.doCache, 0),
    codigosDesconhecidos: [...new Set(resultados.flatMap((resultado) => resultado.desconhecidos))],
  };
}

/**
 * Códigos curtos e únicos para as categorias do perfil, válidos só dentro de
 * uma requisição. O modelo escreve o código; o nome é o que o cache guarda.
 */
export function codificarCategorias(
  categorias: ReadonlyArray<{ id: string; name: string; description: string | null; kind: string }>,
): Array<CategoriaDisponivel & { categoriaId: string }> {
  const usados = new Set<string>();
  return categorias.map((categoria) => {
    const base =
      categoria.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 5) || "CAT";
    let codigo = base;
    for (let sufixo = 2; usados.has(codigo); sufixo += 1) codigo = `${base}${sufixo}`;
    usados.add(codigo);
    return {
      codigo,
      nome: categoria.name,
      descricao: categoria.description,
      kind: categoria.kind === "income" ? "income" : "expense",
      categoriaId: categoria.id,
    };
  });
}
