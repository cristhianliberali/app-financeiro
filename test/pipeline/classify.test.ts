import { describe, expect, test } from "bun:test";

import { dividirEmBlocos, emParalelo } from "@/integrations/ai/pipeline/blocks";
import { canonizar } from "@/integrations/ai/pipeline/canonical.server";
import {
  candidatos,
  classificar,
  ClassificacaoIncompletaError,
  lerDecisoes,
  type Categoria,
} from "@/integrations/ai/pipeline/classify.server";
import { cacheEmMemoria, chaveMerchant } from "@/integrations/ai/pipeline/merchants.server";
import type { LlmClient, PedidoLlm } from "@/integrations/ai/pipeline/provider.server";
import { TipoLinha, tipar, type DocumentoTipado } from "@/integrations/ai/pipeline/typing";

const HOJE = new Date("2026-02-20T12:00:00Z");

const CATEGORIAS: Categoria[] = [
  { codigo: "GAS", nome: "Alimentação", descricao: "mercado, padaria, restaurante" },
  { codigo: "SRV", nome: "Serviços", descricao: "assinaturas e mensalidades" },
  { codigo: "TUR", nome: "Viagem", descricao: null },
];

const VALIDAS = new Set(CATEGORIAS.map((categoria) => categoria.codigo));

/** Cliente falso: nenhum teste desta camada chega perto da API de verdade. */
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

const decisoesPara = (ids: number[], categoria = "GAS") =>
  ids.map((id) => `${id}:L,${categoria},0.9`).join("\n");

/** Fatura sintética com `quantidade` lançamentos, todos com data e valor. */
async function documentoCom(quantidade: number): Promise<DocumentoTipado> {
  const linhas = ["Vencimento: 10/02/2026", ""];
  for (let i = 0; i < quantidade; i += 1) {
    const dia = String((i % 28) + 1).padStart(2, "0");
    linhas.push(`${dia} JAN   LOJA ${String(i).padStart(3, "0")}   CHAPECO   R$ 1${i % 10},00`);
  }
  const bytes = new TextEncoder().encode(linhas.join("\n"));
  return tipar(await canonizar({ nome: "sintetica.txt", bytes }), { hoje: HOJE });
}

describe("camada 3 — blocos", () => {
  test("blocos consecutivos compartilham as linhas de fronteira", () => {
    const blocos = dividirEmBlocos([1, 2, 3, 4, 5, 6, 7, 8], 4, 2);

    expect(blocos.map((bloco) => bloco.ids)).toEqual([
      [1, 2, 3, 4],
      [3, 4, 5, 6],
      [5, 6, 7, 8],
    ]);
    expect(blocos.map((bloco) => bloco.sobrepostos)).toEqual([[], [3, 4], [5, 6]]);
  });

  test("todo id entra em pelo menos um bloco", () => {
    const ids = Array.from({ length: 120 }, (_, i) => i + 1);
    const cobertos = new Set(dividirEmBlocos(ids, 25, 2).flatMap((bloco) => bloco.ids));
    expect(cobertos.size).toBe(120);
  });

  test("sobra que o bloco anterior já cobre não vira chamada nova", () => {
    expect(dividirEmBlocos([1, 2, 3, 4, 5], 4, 2).map((bloco) => bloco.ids)).toEqual([
      [1, 2, 3, 4],
      [3, 4, 5],
    ]);
    expect(dividirEmBlocos([1, 2, 3], 4, 2)).toHaveLength(1);
  });

  test("sobreposição maior que o bloco é recusada", () => {
    expect(() => dividirEmBlocos([1, 2, 3], 2, 2)).toThrow("precisa ser menor");
  });

  test("o paralelismo respeita o teto de concorrência", async () => {
    let ativos = 0;
    let pico = 0;
    const resultado = await emParalelo([1, 2, 3, 4, 5, 6], 2, async (item) => {
      ativos += 1;
      pico = Math.max(pico, ativos);
      await Promise.resolve();
      ativos -= 1;
      return item * 2;
    });

    expect(resultado).toEqual([2, 4, 6, 8, 10, 12]);
    expect(pico).toBeLessThanOrEqual(2);
  });
});

describe("camada 3 — protocolo", () => {
  test("lê o formato id:tipo,categoria,confianca, tolerando espaços", () => {
    const { decisoes } = lerDecisoes("40:L,GAS,0.7\n  41 : L , SRV , 0.95 \n42:T,-,1", VALIDAS);

    expect(decisoes).toEqual([
      { id: 40, tipo: TipoLinha.LANCAMENTO, categoria: "GAS", confianca: 0.7 },
      { id: 41, tipo: TipoLinha.LANCAMENTO, categoria: "SRV", confianca: 0.95 },
      { id: 42, tipo: TipoLinha.TOTAL_DECLARADO, categoria: null, confianca: 1 },
    ]);
  });

  test("texto solto em volta da resposta não derruba o bloco", () => {
    const { decisoes } = lerDecisoes(
      "Claro! Aqui estão:\n40:L,GAS,0.7\n\nEspero ter ajudado.",
      VALIDAS,
    );
    expect(decisoes.map((decisao) => decisao.id)).toEqual([40]);
  });

  test("categoria fora do enum zera a confiança em vez de derrubar a decisão", () => {
    const { decisoes, categoriasDesconhecidas } = lerDecisoes("40:L,PIZZA,0.9", VALIDAS);

    expect(decisoes[0]).toMatchObject({ id: 40, categoria: null, confianca: 0 });
    expect(categoriasDesconhecidas).toEqual(["PIZZA"]);
  });
});

describe("camada 3 — contrato de contagem", () => {
  test("linha faltando dispara retry só daquele id", async () => {
    const documento = await documentoCom(5);
    const ids = candidatos(documento).map((linha) => linha.id);
    const ausente = ids[2]!;

    const cliente = clienteFalso((recebidos, _pedido, chamada) =>
      decisoesPara(chamada === 1 ? recebidos.filter((id) => id !== ausente) : recebidos),
    );
    const resultado = await classificar({ documento, categorias: CATEGORIAS, cliente });

    expect(cliente.pedidos).toHaveLength(2);
    // A segunda chamada carrega só o id faltante: o bloco não é reprocessado.
    expect(
      [...cliente.pedidos[1]!.usuario.matchAll(/^(\d+):/gm)].map(([, id]) => Number(id)),
    ).toEqual([ausente]);
    expect(resultado.decisoes.map((decisao) => decisao.id)).toEqual(ids);
  });

  test("id inventado é descartado e registrado", async () => {
    const documento = await documentoCom(4);
    const ids = candidatos(documento).map((linha) => linha.id);

    const cliente = clienteFalso((recebidos) => `${decisoesPara(recebidos)}\n9999:L,GAS,0.9`);
    const resultado = await classificar({ documento, categorias: CATEGORIAS, cliente });

    expect(resultado.extras).toEqual([9999]);
    expect(resultado.decisoes.map((decisao) => decisao.id)).toEqual(ids);
  });

  test("documento de 120 linhas em blocos de 25 produz 120 decisões", async () => {
    const documento = await documentoCom(120);
    const ids = candidatos(documento).map((linha) => linha.id);
    expect(ids).toHaveLength(120);

    const cliente = clienteFalso((recebidos) => decisoesPara(recebidos));
    const resultado = await classificar({
      documento,
      categorias: CATEGORIAS,
      cliente,
      opcoes: { tamanhoBloco: 25, sobreposicao: 2 },
    });

    expect(resultado.decisoes).toHaveLength(120);
    expect(resultado.decisoes.map((decisao) => decisao.id)).toEqual(ids);
    expect(resultado.chamadas).toBe(6);
  });

  test("id que nem o retry resolve impede o pipeline de avançar", async () => {
    const documento = await documentoCom(3);
    const teimoso = candidatos(documento)[1]!.id;

    const cliente = clienteFalso((recebidos) =>
      decisoesPara(recebidos.filter((id) => id !== teimoso)),
    );

    await expect(classificar({ documento, categorias: CATEGORIAS, cliente })).rejects.toThrow(
      ClassificacaoIncompletaError,
    );
    await classificar({ documento, categorias: CATEGORIAS, cliente }).catch(
      (erro: ClassificacaoIncompletaError) => expect(erro.faltando).toEqual([teimoso]),
    );
  });
});

describe("camada 3 — fronteiras e cache", () => {
  test("divergência na linha de sobreposição marca revisão", async () => {
    const documento = await documentoCom(6);
    const ids = candidatos(documento).map((linha) => linha.id);
    // Blocos de 4 com sobreposição de 2: os ids 3 e 4 caem nos dois blocos.
    const fronteira = ids[3]!;

    const cliente = clienteFalso((recebidos, _pedido, chamada) =>
      recebidos
        .map((id) => `${id}:L,${id === fronteira && chamada > 1 ? "TUR" : "GAS"},0.9`)
        .join("\n"),
    );
    const resultado = await classificar({
      documento,
      categorias: CATEGORIAS,
      cliente,
      opcoes: { tamanhoBloco: 4, sobreposicao: 2, concorrencia: 1 },
    });

    expect(resultado.divergencias).toEqual([fronteira]);
    // A primeira decisão fica valendo; quem resolve o empate é a revisão.
    expect(resultado.decisoes.find((decisao) => decisao.id === fronteira)?.categoria).toBe("GAS");
  });

  test("merchant conhecido não entra nos blocos", async () => {
    const documento = await documentoCom(4);
    const linhas = candidatos(documento);
    const conhecida = linhas[1]!;

    const cache = cacheEmMemoria({ [conhecida.descricao!]: { categoria: "SRV", confianca: 1 } });
    const cliente = clienteFalso((recebidos) => decisoesPara(recebidos));
    const resultado = await classificar({ documento, categorias: CATEGORIAS, cliente, cache });

    expect(resultado.doCache).toBe(1);
    expect(cliente.pedidos[0]!.usuario).not.toContain(`${conhecida.id}:`);
    expect(resultado.decisoes.find((decisao) => decisao.id === conhecida.id)).toMatchObject({
      categoria: "SRV",
      origem: "cache",
    });
    expect(resultado.decisoes).toHaveLength(linhas.length);
  });

  test("decisão limpa do modelo alimenta o cache para o próximo documento", async () => {
    const documento = await documentoCom(2);
    const cache = cacheEmMemoria();
    const cliente = clienteFalso((recebidos) => decisoesPara(recebidos, "TUR"));

    await classificar({ documento, categorias: CATEGORIAS, cliente, cache });

    const primeira = candidatos(documento)[0]!;
    expect(await cache.buscar(chaveMerchant(primeira.descricao!))).toEqual({
      categoria: "TUR",
      confianca: 0.9,
    });
  });

  test("o modelo contradizer a tipagem determinística fica registrado", async () => {
    const documento = await documentoCom(3);
    const ids = candidatos(documento).map((linha) => linha.id);

    const cliente = clienteFalso((recebidos) =>
      recebidos.map((id) => `${id}:${id === ids[0] ? "T,-" : "L,GAS"},0.9`).join("\n"),
    );
    const resultado = await classificar({ documento, categorias: CATEGORIAS, cliente });

    expect(resultado.conflitosDeTipo).toEqual([ids[0]!]);
  });
});
