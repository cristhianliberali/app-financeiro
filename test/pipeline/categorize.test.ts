import { describe, expect, test } from "bun:test";

import {
  categorizarTransacoes,
  codificarCategorias,
  lerDecisoesDeCategoria,
  type CategoriaDisponivel,
  type ItemParaCategorizar,
} from "@/integrations/ai/pipeline/categorize.server";
import { ClassificacaoIncompletaError } from "@/integrations/ai/pipeline/classify.server";
import { cacheEmMemoria, chaveMerchant } from "@/integrations/ai/pipeline/merchants.server";
import type { LlmClient, PedidoLlm } from "@/integrations/ai/pipeline/provider.server";

const CATEGORIAS: CategoriaDisponivel[] = [
  { codigo: "MERC", nome: "Mercado", descricao: "supermercado, padaria", kind: "expense" },
  { codigo: "TRANS", nome: "Transporte", descricao: "posto, uber", kind: "expense" },
  { codigo: "SALAR", nome: "Salário", descricao: "recebimentos", kind: "income" },
];

const ITENS: ItemParaCategorizar[] = [
  { id: 10, descricao: "VIPI SUPERMERCADOS E", valor: 251.65, kind: "expense" },
  { id: 11, descricao: "POSTO MAXIMO", valor: 363.03, kind: "expense" },
  { id: 12, descricao: "PIX RECEBIDO EMPRESA", valor: 5000, kind: "income" },
];

/** Cliente falso; nenhum teste chega perto da API de verdade. */
function clienteFalso(
  responder: (ids: number[], pedido: PedidoLlm, chamada: number) => string,
): LlmClient & { pedidos: PedidoLlm[] } {
  const pedidos: PedidoLlm[] = [];
  return {
    nome: "falso",
    pedidos,
    async completar(pedido) {
      pedidos.push(pedido);
      const ids = [...pedido.usuario.matchAll(/^(\d+):/gm)].map(([, id]) => Number(id));
      return responder(ids, pedido, pedidos.length);
    },
  };
}

describe("etapa 2 — protocolo de categorização", () => {
  test("lê id:codigo,confianca e aceita o - de nenhuma categoria", () => {
    const validos = new Set(["MERC", "TRANS"]);
    const { decisoes } = lerDecisoesDeCategoria("10:MERC,0.95\n 11 : - , 0.4 ", validos);

    expect(decisoes).toEqual([
      { id: 10, codigo: "MERC", confianca: 0.95 },
      { id: 11, codigo: null, confianca: 0.4 },
    ]);
  });

  test("código fora do enum zera a confiança em vez de derrubar a decisão", () => {
    const { decisoes, desconhecidos } = lerDecisoesDeCategoria("10:PIZZA,0.9", new Set(["MERC"]));
    expect(decisoes[0]).toEqual({ id: 10, codigo: null, confianca: 0 });
    expect(desconhecidos).toEqual(["PIZZA"]);
  });
});

describe("etapa 2 — categorização por rodadas", () => {
  test("gasto e entrada rodam separados, cada um com o próprio enum", async () => {
    const porRodada: string[] = [];
    const cliente = clienteFalso((ids, pedido) => {
      porRodada.push(pedido.sistema.includes("gastos") ? "expense" : "income");
      // O modelo tenta dar categoria de salário a um gasto: o código nem
      // existe no enum daquela rodada, então a decisão volta sem categoria.
      return ids.map((id) => `${id}:${id === 12 ? "SALAR" : "SALAR"},0.9`).join("\n");
    });

    const resultado = await categorizarTransacoes({
      itens: ITENS,
      categorias: CATEGORIAS,
      cliente,
    });

    expect(porRodada.sort()).toEqual(["expense", "income"]);
    const porId = new Map(resultado.decisoes.map((decisao) => [decisao.id, decisao]));
    expect(porId.get(10)!.codigo).toBeNull();
    expect(porId.get(11)!.codigo).toBeNull();
    expect(porId.get(12)!.codigo).toBe("SALAR");
    expect(resultado.codigosDesconhecidos).toEqual(["SALAR"]);
  });

  test("merchant conhecido sai do cache e nem vira requisição", async () => {
    const cache = cacheEmMemoria({
      "VIPI SUPERMERCADOS E": { categoria: "Mercado", confianca: 1 },
    });
    const cliente = clienteFalso((ids) => ids.map((id) => `${id}:TRANS,0.9`).join("\n"));

    const resultado = await categorizarTransacoes({
      itens: ITENS.filter((item) => item.kind === "expense"),
      categorias: CATEGORIAS,
      cliente,
      cache,
    });

    const vipi = resultado.decisoes.find((decisao) => decisao.id === 10)!;
    expect(vipi).toMatchObject({ codigo: "MERC", origem: "cache" });
    expect(resultado.doCache).toBe(1);
    for (const pedido of cliente.pedidos) expect(pedido.usuario).not.toContain("10:");
  });

  test("cache apontando para categoria que o perfil não tem é tratado como ausência", async () => {
    const cache = cacheEmMemoria({
      "VIPI SUPERMERCADOS E": { categoria: "Categoria Antiga", confianca: 1 },
    });
    const cliente = clienteFalso((ids) => ids.map((id) => `${id}:MERC,0.9`).join("\n"));

    const resultado = await categorizarTransacoes({
      itens: [ITENS[0]!],
      categorias: CATEGORIAS,
      cliente,
      cache,
    });

    expect(resultado.doCache).toBe(0);
    expect(resultado.decisoes[0]).toMatchObject({ codigo: "MERC", origem: "ia" });
  });

  test("decisão do modelo alimenta o cache com o NOME da categoria", async () => {
    const cache = cacheEmMemoria();
    const cliente = clienteFalso((ids) => ids.map((id) => `${id}:TRANS,0.85`).join("\n"));

    await categorizarTransacoes({
      itens: [ITENS[1]!],
      categorias: CATEGORIAS,
      cliente,
      cache,
    });

    expect(await cache.buscar(chaveMerchant("POSTO MAXIMO"))).toEqual({
      categoria: "Transporte",
      confianca: 0.85,
    });
  });

  test("id faltando volta a ser perguntado sozinho; id inventado é descartado", async () => {
    const cliente = clienteFalso((ids, _pedido, chamada) =>
      [
        ...ids.filter((id) => chamada > 1 || id !== 11).map((id) => `${id}:MERC,0.9`),
        "9999:MERC,0.9",
      ].join("\n"),
    );

    const resultado = await categorizarTransacoes({
      itens: ITENS.filter((item) => item.kind === "expense"),
      categorias: CATEGORIAS,
      cliente,
    });

    expect(cliente.pedidos).toHaveLength(2);
    expect(
      [...cliente.pedidos[1]!.usuario.matchAll(/^(\d+):/gm)].map(([, id]) => Number(id)),
    ).toEqual([11]);
    expect(resultado.decisoes.map((decisao) => decisao.id)).toEqual([10, 11]);
    expect(resultado.decisoes.some((decisao) => decisao.id === 9999)).toBe(false);
  });

  test("id que nem o retry resolve impede a categorização de terminar", async () => {
    const cliente = clienteFalso((ids) =>
      ids
        .filter((id) => id !== 11)
        .map((id) => `${id}:MERC,0.9`)
        .join("\n"),
    );

    await expect(
      categorizarTransacoes({
        itens: ITENS.filter((item) => item.kind === "expense"),
        categorias: CATEGORIAS,
        cliente,
      }),
    ).rejects.toThrow(ClassificacaoIncompletaError);
  });
});

describe("etapa 2 — códigos de categoria", () => {
  test("nomes viram códigos curtos, sem acento e sem colisão", () => {
    const codificadas = codificarCategorias([
      { id: "a", name: "Alimentação", description: null, kind: "expense" },
      { id: "b", name: "Alimentos e Bebidas", description: null, kind: "expense" },
      { id: "c", name: "Saúde", description: "farmácia", kind: "expense" },
      { id: "d", name: "Salário", description: null, kind: "income" },
    ]);

    expect(codificadas.map((categoria) => categoria.codigo)).toEqual([
      "ALIME",
      "ALIME2",
      "SAUDE",
      "SALAR",
    ]);
    expect(codificadas[0]!.categoriaId).toBe("a");
    expect(codificadas[3]!.kind).toBe("income");
  });
});
