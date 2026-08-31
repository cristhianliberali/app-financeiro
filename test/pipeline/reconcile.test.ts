import { describe, expect, test } from "bun:test";

import { canonizar } from "@/integrations/ai/pipeline/canonical.server";
import {
  combinacaoAssinada,
  contagemNaFaixa,
  convencaoUniforme,
  datasNoPeriodo,
  reconciliar,
  subconjuntoQueSoma,
  valorAcimaDoDocumento,
} from "@/integrations/ai/pipeline/reconcile";
import {
  ConvencaoMistaError,
  lancamentos,
  tipar,
  type DocumentoTipado,
} from "@/integrations/ai/pipeline/typing";

const HOJE = new Date("2026-02-20T12:00:00Z");

async function fixture(): Promise<string> {
  return Bun.file("test/fixtures/fatura-sicoob.txt").text();
}

async function tiparTexto(texto: string): Promise<DocumentoTipado> {
  const bytes = new TextEncoder().encode(texto);
  return tipar(await canonizar({ nome: "fatura.txt", bytes }), { hoje: HOJE });
}

const fechamentoDe = (documento: DocumentoTipado, rotulo: string) =>
  reconciliar(documento).totais.find((total) => total.total.rotulo.includes(rotulo))!;

describe("camada 4 — busca de combinações", () => {
  test("acha o subconjunto que soma o alvo, inclusive com estorno", () => {
    const itens = [
      { id: 1, centavos: 2990 },
      { id: 2, centavos: -2990 },
      { id: 3, centavos: 4200 },
      { id: 4, centavos: 11000 },
    ];
    expect(subconjuntoQueSoma(itens, 4200)).toEqual([3]);
    expect(subconjuntoQueSoma(itens, 0)).toEqual([1, 2]);
    expect(subconjuntoQueSoma(itens, 777)).toBeNull();
  });

  test("acha a identidade assinada de um resumo de fatura", () => {
    // 8.165,23 − 8.338,69 + 144,00 + 6.628,04 = 6.598,58
    const itens = [
      { id: 1, centavos: 816523 },
      { id: 2, centavos: 833869 },
      { id: 3, centavos: 14400 },
      { id: 4, centavos: 662804 },
    ];
    expect(combinacaoAssinada(itens, 659858)).toEqual([1, 2, 3, 4]);
    expect(combinacaoAssinada(itens, 1)).toBeNull();
  });
});

describe("camada 4 — fixture dourada", () => {
  test("todos os checksums declarados fecham", async () => {
    const documento = await tiparTexto(await fixture());
    const relatorio = reconciliar(documento);

    expect(relatorio.fechouTudo).toBe(true);
    expect(relatorio.orfaos).toEqual([]);
    expect(relatorio.alertas).toEqual([]);

    const porRotulo = Object.fromEntries(
      relatorio.totais.map((fechamento) => [fechamento.total.rotulo, fechamento]),
    );

    // Totais por portador: cada bloco soma o próprio subtotal.
    expect(porRotulo["TOTAL FINAL 6567"]).toMatchObject({ via: "grupo", fechou: true });
    expect(porRotulo["TOTAL FINAL 6567"]!.total.valor).toBe(110);
    expect(porRotulo["TOTAL FINAL 9661"]!.total.valor).toBe(435.47);
    expect(porRotulo["TOTAL FINAL 5249"]!.total.valor).toBe(6017.11);
    expect(porRotulo["TOTAL MOVIMENTACOES"]!.total.valor).toBe(65.46);

    // Compras do período: a soma dos subtotais que já fecharam.
    expect(porRotulo["COMPRAS DO PERIODO"]).toMatchObject({ via: "subtotais", fechou: true });
    expect(porRotulo["COMPRAS DO PERIODO"]!.total.valor).toBe(6628.04);

    // Identidade do resumo: 8.165,23 − 8.338,69 + 144,00 + 6.628,04 = 6.598,58.
    expect(porRotulo["TOTAL A PAGAR"]).toMatchObject({ via: "identidade", fechou: true });
    expect(porRotulo["TOTAL A PAGAR"]!.total.valor).toBe(6598.58);
  });

  test("todo lançamento entra em algum total que fechou", async () => {
    const documento = await tiparTexto(await fixture());
    const relatorio = reconciliar(documento);

    const cobertos = new Set(
      relatorio.totais.filter((total) => total.fechou).flatMap((total) => total.parcelas),
    );
    for (const linha of lancamentos(documento)) expect(cobertos.has(linha.id)).toBe(true);
  });

  test("remover um lançamento faz o total do portador falhar", async () => {
    const texto = (await fixture())
      .split("\n")
      .filter((linha) => !linha.includes("VIPI SUPERMERCADOS"))
      .join("\n");
    const documento = await tiparTexto(texto);
    const relatorio = reconciliar(documento);

    const portador = fechamentoDe(documento, "TOTAL FINAL 9661");
    expect(portador.fechou).toBe(false);
    expect(portador.via).toBeNull();
    // O que falta é exatamente o lançamento removido.
    expect(portador.diferenca).toBeCloseTo(251.65, 2);
    expect(relatorio.fechouTudo).toBe(false);

    // E os lançamentos do bloco quebrado ficam órfãos, em vez de sumirem.
    const orfaos = relatorio.orfaos.map(
      (id) => documento.linhas.find((linha) => linha.id === id)!.descricao,
    );
    expect(orfaos).toEqual(["THE BEST ACAI MARAVI", "D CERUTTI"]);
  });

  test("os outros blocos continuam fechando quando um quebra", async () => {
    const texto = (await fixture())
      .split("\n")
      .filter((linha) => !linha.includes("VIPI SUPERMERCADOS"))
      .join("\n");
    const documento = await tiparTexto(texto);

    expect(fechamentoDe(documento, "TOTAL FINAL 5249").fechou).toBe(true);
    expect(fechamentoDe(documento, "TOTAL MOVIMENTACOES").fechou).toBe(true);
  });
});

describe("camada 4 — sanidade semântica", () => {
  test("trocar a convenção decimal de uma linha é recusado já na tipagem", async () => {
    const texto = (await fixture()).replace("R$ 1,240.50", "R$ 1.240,50");
    await expect(tiparTexto(texto)).rejects.toThrow(ConvencaoMistaError);
  });

  test("e o validador é o segundo sinal, independente da detecção", async () => {
    const documento = await tiparTexto(await fixture());
    expect(convencaoUniforme.verificar({ documento, lancamentos: [] })).toEqual([]);

    const adulterado: DocumentoTipado = {
      ...documento,
      linhas: documento.linhas.map((linha) =>
        linha.texto.includes("AIRBNB") ? { ...linha, texto: "08 JUN AIRBNB R$ 1.240,50" } : linha,
      ),
    };
    const alertas = convencaoUniforme.verificar({ documento: adulterado, lancamentos: [] });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.mensagem).toContain('convenção "us"');
  });

  test("data depois do fim do período é apontada", async () => {
    const texto = (await fixture()).replace("25 JAN   POSTO IPIRANGA", "20 FEV   POSTO IPIRANGA");
    const documento = await tiparTexto(texto);
    const alertas = datasNoPeriodo.verificar({ documento, lancamentos: lancamentos(documento) });

    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.mensagem).toContain("posterior ao fim do período");
  });

  test("parcela antiga não é anomalia", async () => {
    const documento = await tiparTexto(await fixture());
    // 17 JUL e 08 JUN são de 2025, antes do período — e trazem marca de parcela.
    expect(datasNoPeriodo.verificar({ documento, lancamentos: lancamentos(documento) })).toEqual(
      [],
    );
  });

  test("valor acima do que o documento comporta é apontado", async () => {
    const texto = (await fixture()).replace("R$ 300.00", "R$ 30,000.00");
    const documento = await tiparTexto(texto);
    const alertas = valorAcimaDoDocumento.verificar({
      documento,
      lancamentos: lancamentos(documento),
    });

    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.linhas).toHaveLength(1);
  });

  test("contagem fora da faixa histórica é apontada", async () => {
    const documento = await tiparTexto(await fixture());
    const contexto = { documento, lancamentos: lancamentos(documento) };

    expect(contagemNaFaixa(10, 30).verificar(contexto)).toEqual([]);
    expect(contagemNaFaixa(50, 80).verificar(contexto)[0]!.mensagem).toContain("fora da faixa");
  });

  test("os validadores são plugáveis", async () => {
    const documento = await tiparTexto(await fixture());
    const relatorio = reconciliar(documento, {
      validadores: [
        { nome: "sempre", verificar: () => [{ validador: "sempre", mensagem: "oi", linhas: [] }] },
      ],
    });
    expect(relatorio.alertas.map((alerta) => alerta.validador)).toEqual(["sempre"]);
  });
});
