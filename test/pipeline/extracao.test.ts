import { describe, expect, test } from "bun:test";

import { extrairParaTela } from "@/integrations/ai/pipeline/extracao.server";

const HOJE = new Date("2026-02-20T12:00:00Z");

const fixture = () => Bun.file("test/fixtures/fatura-sicoob.txt").text();

async function extrair(texto: string) {
  return extrairParaTela({ text: texto }, { hoje: HOJE });
}

describe("extração para a tela — sem IA nenhuma", () => {
  test("a fatura inteira sai de uma vez, com as transações na ordem do documento", async () => {
    const extracao = await extrair(await fixture());

    expect(extracao.transacoes).toHaveLength(17);
    expect(extracao.vencimento).toBe("2026-02-10");
    expect(extracao.convencao).toBe("us");

    const vipi = extracao.transacoes.find((t) => t.descricao === "VIPI SUPERMERCADOS E")!;
    expect(vipi).toMatchObject({
      valor: 251.65,
      kind: "expense",
      estorno: false,
      dataIso: "2026-01-12",
      dataRaw: "12 JAN",
      grupo: "PORTADOR BELTRANA DE TAL - FINAL 9661",
      avisos: [],
    });

    const parcelada = extracao.transacoes.find((t) => t.descricao.startsWith("AIRBNB"))!;
    expect(parcelada.parcela).toEqual({ numero: 5, total: 6 });
    expect(parcelada.dataIso).toBe("2025-06-08");
  });

  test("estorno vira crédito, com a flag visível", async () => {
    const extracao = await extrair(await fixture());
    const estornos = extracao.transacoes.filter((t) => t.estorno);

    expect(estornos).toHaveLength(1);
    expect(estornos[0]).toMatchObject({
      descricao: "PG *PAGTRUST TECNOLO",
      valor: 29.9,
      kind: "income",
    });
  });

  test("a conferência mostra cada total declarado e se ele fechou", async () => {
    const extracao = await extrair(await fixture());

    expect(extracao.conferencia.disponivel).toBe(true);
    expect(extracao.conferencia.fechouTudo).toBe(true);
    expect(extracao.conferencia.totais).toHaveLength(9);

    const aPagar = extracao.conferencia.totais.find((t) => t.rotulo === "TOTAL A PAGAR")!;
    expect(aPagar).toMatchObject({ valor: 6598.58, fechou: true });
  });

  test("remover uma linha aparece como total aberto e transações órfãs", async () => {
    const texto = (await fixture())
      .split("\n")
      .filter((linha) => !linha.includes("VIPI SUPERMERCADOS"))
      .join("\n");
    const extracao = await extrair(texto);

    const portador = extracao.conferencia.totais.find((t) => t.rotulo === "TOTAL FINAL 9661")!;
    expect(portador.fechou).toBe(false);
    expect(portador.diferenca).toBeCloseTo(251.65, 2);
    expect(extracao.conferencia.fechouTudo).toBe(false);

    const orfas = extracao.transacoes.filter((t) => t.avisos.includes("orfao"));
    expect(orfas.map((t) => t.descricao)).toEqual(["THE BEST ACAI MARAVI", "D CERUTTI"]);
  });

  test("linha que nenhuma regra resolveu aparece na tela, nunca some", async () => {
    const extracao = await extrair(await fixture());
    const textos = extracao.naoInterpretadas.map((linha) => linha.texto);

    expect(textos).toContain("Titular: FULANO DE TAL");
    expect(textos).toContain("Vencimento: 10/02/2026");
    expect(extracao.naoInterpretadas).toHaveLength(5);
  });

  test("documento sem total declarado não marca tudo como órfão", async () => {
    const csv = [
      "data;descricao;valor",
      "04/01/2026;PADARIA CENTRAL;12,50",
      "05/01/2026;POSTO IPIRANGA;300,00",
    ].join("\n");
    const extracao = await extrair(csv);

    expect(extracao.origem).toBe("csv");
    expect(extracao.transacoes).toHaveLength(2);
    expect(extracao.conferencia.disponivel).toBe(false);
    expect(extracao.transacoes.every((t) => t.avisos.length === 0)).toBe(true);
  });

  test("no OFX o sinal é do banco: débito é gasto, crédito é entrada", async () => {
    const ofx = [
      "OFXHEADER:100",
      "<OFX><BANKTRANLIST><DTSTART>20260105</DTSTART><DTEND>20260204</DTEND>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-45.00",
      "<NAME>PADARIA CENTRAL</STMTTRN>",
      "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260115<TRNAMT>1200.00",
      "<NAME>SALARIO</STMTTRN>",
      "</BANKTRANLIST></OFX>",
    ].join("\n");
    const extracao = await extrair(ofx);

    expect(extracao.origem).toBe("ofx");
    expect(extracao.transacoes).toHaveLength(2);
    expect(extracao.transacoes[0]).toMatchObject({ valor: 45, kind: "expense" });
    expect(extracao.transacoes[1]).toMatchObject({ valor: 1200, kind: "income" });
  });

  test("arquivo chega em base64 e sai igual ao texto colado", async () => {
    const texto = await fixture();
    const doArquivo = await extrairParaTela(
      { file: { name: "fatura.txt", base64: Buffer.from(texto).toString("base64") } },
      { hoje: HOJE },
    );
    const doTexto = await extrair(texto);

    expect(doArquivo.transacoes).toEqual(doTexto.transacoes);
  });
});

describe("extração para a tela — extrato bancário em PDF/texto", () => {
  test("com marcas D/C o sinal é do banco, e crédito não vira estorno", async () => {
    const extracao = await extrair(
      [
        "EXTRATO DE CONTA CORRENTE",
        "Período: 05/07 a 04/08",
        "VENCIMENTO 11/08/2026",
        "10/07/2026  PIX RECEBIDO JOAO      1.234,56 C",
        "11/07/2026  BOLETO ENERGIA          200,00 D",
        "12/07/2026  COMPRA CARTAO SUPERM     89,90 D",
      ].join("\n"),
    );

    expect(extracao.transacoes).toHaveLength(3);
    expect(extracao.transacoes[0]).toMatchObject({ valor: 1234.56, kind: "income" });
    expect(extracao.transacoes[1]).toMatchObject({ valor: 200, kind: "expense" });
    expect(extracao.transacoes[2]).toMatchObject({ valor: 89.9, kind: "expense" });
    // Extrato não anuncia estorno: crédito ali é só crédito.
    expect(extracao.transacoes.every((t) => !t.estorno)).toBe(true);
  });

  test("no OFX o crédito também não carrega a marca de estorno", async () => {
    const ofx = [
      "OFXHEADER:100",
      "<OFX><BANKTRANLIST><DTSTART>20260105</DTSTART><DTEND>20260204</DTEND>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-45.00",
      "<NAME>PADARIA CENTRAL</STMTTRN>",
      "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260115<TRNAMT>1200.00",
      "<NAME>SALARIO</STMTTRN>",
      "</BANKTRANLIST></OFX>",
    ].join("\n");
    const extracao = await extrair(ofx);

    expect(extracao.transacoes.every((t) => !t.estorno)).toBe(true);
  });
});
