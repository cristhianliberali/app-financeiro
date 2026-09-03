/**
 * Importação de documentos em duas etapas.
 *
 * Etapa 1 (esta): o servidor extrai as transações do arquivo por código, sem
 * nenhuma requisição de IA, e a tela mostra tudo de uma vez. Etapa 2 (botão
 * "Categorizar com IA"): só as decisões de categoria vão para o modelo — as
 * categorias disponíveis e as linhas numeradas, nunca o arquivo inteiro.
 */
import { createServerFn } from "@tanstack/react-start";

import { requirePlano } from "@/integrations/postgres/auth-middleware";
import type { ExtracaoParaTela } from "@/integrations/ai/pipeline/extracao.server";

export type {
  ConferenciaExtracao,
  ExtracaoParaTela,
  TotalConferido,
  TransacaoExtraida,
} from "@/integrations/ai/pipeline/extracao.server";

/** Extensões que a extração sabe ler. */
export const ACCEPTED_UPLOAD = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv,.txt,.ofx";

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

/**
 * Extrai as transações do documento, de uma vez só. Determinístico: reprocessar
 * o mesmo arquivo devolve exatamente o mesmo resultado, e não gasta IA.
 */
export const extractDocument = createServerFn({ method: "POST" })
  .middleware([requirePlano])
  .inputValidator(
    (input: { profileId: string; text?: string; file?: { name: string; base64: string } }) => {
      const profileId = requireId(input?.profileId, "profileId");
      if (input?.file) {
        if (typeof input.file.name !== "string" || typeof input.file.base64 !== "string") {
          throw new Error("Arquivo inválido");
        }
        return { profileId, file: { name: input.file.name, base64: input.file.base64 } };
      }
      const text = typeof input?.text === "string" ? input.text.trim() : "";
      if (text.length < 10) throw new Error("Cole o texto da fatura ou anexe um arquivo");
      return { profileId, text };
    },
  )
  .handler(async ({ data, context }): Promise<ExtracaoParaTela> => {
    const { requireProfileAccess } = await import("@/integrations/postgres/access.server");
    await requireProfileAccess(context.user.id, data.profileId, "editor");

    const { extrairParaTela } = await import("@/integrations/ai/pipeline/extracao.server");
    const extracao = await extrairParaTela(data);

    console.info(
      `[importação] extração determinística: usuário=${context.user.id} ` +
        `perfil=${data.profileId} origem=${extracao.origem} ` +
        `linhas=${extracao.estatisticas.linhas} transações=${extracao.transacoes.length} ` +
        `não_interpretadas=${extracao.naoInterpretadas.length} ` +
        `conferência=${extracao.conferencia.disponivel ? (extracao.conferencia.fechouTudo ? "fechou" : "aberta") : "sem totais"}`,
    );

    return extracao;
  });

export type CategoriaAplicada = {
  linhaId: number;
  /** Id da categoria do perfil; `null` quando nenhuma serviu. */
  categoryId: string | null;
  categoria: string | null;
  confianca: number;
  origem: "cache" | "ia";
};

export type RespostaCategorizacao = {
  decisoes: CategoriaAplicada[];
  /** Requisições feitas ao provedor nesta categorização. */
  chamadas: number;
  /** Decisões que saíram do cache de merchants, sem custo. */
  doCache: number;
};

type ItemBruto = { linhaId: number; descricao: string; valor: number; kind: string };

function validarItens(brutos: unknown): ItemBruto[] {
  if (!Array.isArray(brutos) || brutos.length === 0) {
    throw new Error("Envie ao menos uma transação para categorizar");
  }
  if (brutos.length > 1000) throw new Error("Categorização limitada a 1000 transações por vez");
  return brutos.map((item: unknown) => {
    const bruto = item as Partial<ItemBruto>;
    const descricao = typeof bruto?.descricao === "string" ? bruto.descricao.trim() : "";
    if (!Number.isInteger(bruto?.linhaId) || descricao === "") {
      throw new Error("Transação inválida na categorização");
    }
    return {
      linhaId: bruto.linhaId as number,
      descricao: descricao.slice(0, 200),
      valor: Math.abs(Number(bruto?.valor)) || 0,
      kind: bruto?.kind === "income" ? "income" : "expense",
    };
  });
}

/**
 * Etapa 2: categoriza as transações extraídas na etapa 1.
 *
 * O que vai para a OpenAI são só as categorias disponíveis e os descritores
 * numerados — nunca o arquivo. O modelo devolve `id:codigo,confiança`;
 * merchant já conhecido sai do cache do banco e nem vira requisição, e cada
 * decisão nova alimenta o cache da próxima importação.
 */
export const categorizeDocument = createServerFn({ method: "POST" })
  .middleware([requirePlano])
  .inputValidator((input: { profileId: string; itens: ItemBruto[] }) => ({
    profileId: requireId(input?.profileId, "profileId"),
    itens: validarItens(input?.itens),
  }))
  .handler(async ({ data, context }): Promise<RespostaCategorizacao> => {
    const { requireProfileAccess } = await import("@/integrations/postgres/access.server");
    await requireProfileAccess(context.user.id, data.profileId, "editor");

    const { getAiSettings } = await import("@/integrations/postgres/config.server");
    getAiSettings(); // falha cedo, com a mensagem que diz quais variáveis faltam

    const { query } = await import("@/integrations/postgres/client.server");
    const { codificarCategorias, categorizarTransacoes } =
      await import("@/integrations/ai/pipeline/categorize.server");
    const { chaveMerchant } = await import("@/integrations/ai/pipeline/merchants.server");
    const { carregarRotulos, gravarRotulos } =
      await import("@/integrations/ai/pipeline/merchants-db.server");
    const { clienteOpenAi } = await import("@/integrations/ai/pipeline/provider.server");

    const categorias = codificarCategorias(
      await query<{ id: string; name: string; description: string | null; kind: string }>(
        `SELECT id, name, description, kind FROM categories
          WHERE profile_id = $1 AND archived_at IS NULL
          ORDER BY name`,
        [data.profileId],
      ),
    );

    // O cache vem do banco numa consulta só; o que o modelo decidir de novo
    // volta num upsert só, marcado como palpite de IA.
    const conhecidos = await carregarRotulos(data.itens.map((item) => item.descricao));
    const novos = new Map<
      string,
      { categoria: string; confianca: number; origem: "ia" | "usuario" }
    >();

    const resultado = await categorizarTransacoes({
      itens: data.itens.map((item) => ({
        id: item.linhaId,
        descricao: item.descricao,
        valor: item.valor,
        kind: item.kind === "income" ? "income" : "expense",
      })),
      categorias,
      cliente: clienteOpenAi(),
      cache: {
        async buscar(chave) {
          return conhecidos.get(chaveMerchant(chave)) ?? null;
        },
        async gravar(chave, rotulo) {
          novos.set(chaveMerchant(chave), { ...rotulo, origem: "ia" });
        },
      },
    });
    await gravarRotulos(novos);

    const porCodigo = new Map(categorias.map((categoria) => [categoria.codigo, categoria]));
    const decisoes: CategoriaAplicada[] = resultado.decisoes.map((decisao) => {
      const categoria = decisao.codigo === null ? null : (porCodigo.get(decisao.codigo) ?? null);
      return {
        linhaId: decisao.id,
        categoryId: categoria?.categoriaId ?? null,
        categoria: categoria?.nome ?? null,
        confianca: decisao.confianca,
        origem: decisao.origem,
      };
    });

    console.info(
      `[importação] categorização: usuário=${context.user.id} perfil=${data.profileId} ` +
        `itens=${data.itens.length} do_cache=${resultado.doCache} ` +
        `chamadas=${resultado.chamadas} sem_categoria=${decisoes.filter((d) => !d.categoryId).length} ` +
        `códigos_desconhecidos=${resultado.codigosDesconhecidos.length}`,
    );

    return { decisoes, chamadas: resultado.chamadas, doCache: resultado.doCache };
  });

/**
 * A confirmação do usuário vira rótulo: quando ele lança as transações com as
 * categorias escolhidas, o cache aprende — com peso de gente, que a IA não
 * sobrescreve. É o que faz a próxima fatura chegar já categorizada.
 */
export const learnMerchantLabels = createServerFn({ method: "POST" })
  .middleware([requirePlano])
  .inputValidator(
    (input: { profileId: string; rotulos: Array<{ descricao: string; categoria: string }> }) => ({
      profileId: requireId(input?.profileId, "profileId"),
      rotulos: (Array.isArray(input?.rotulos) ? input.rotulos : [])
        .filter(
          (rotulo) =>
            typeof rotulo?.descricao === "string" &&
            rotulo.descricao.trim() !== "" &&
            typeof rotulo?.categoria === "string" &&
            rotulo.categoria.trim() !== "",
        )
        .slice(0, 1000)
        .map((rotulo) => ({
          descricao: rotulo.descricao.trim().slice(0, 200),
          categoria: rotulo.categoria.trim().slice(0, 100),
        })),
    }),
  )
  .handler(async ({ data, context }): Promise<{ gravados: number }> => {
    const { requireProfileAccess } = await import("@/integrations/postgres/access.server");
    await requireProfileAccess(context.user.id, data.profileId, "editor");
    if (data.rotulos.length === 0) return { gravados: 0 };

    const { chaveMerchant } = await import("@/integrations/ai/pipeline/merchants.server");
    const { gravarRotulos } = await import("@/integrations/ai/pipeline/merchants-db.server");

    const rotulos = new Map(
      data.rotulos.map((rotulo) => [
        chaveMerchant(rotulo.descricao),
        { categoria: rotulo.categoria, confianca: 1, origem: "usuario" as const },
      ]),
    );
    await gravarRotulos(rotulos);
    return { gravados: rotulos.size };
  });
