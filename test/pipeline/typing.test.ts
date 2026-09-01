import { describe, expect, test } from "bun:test";

import { canonizar } from "@/integrations/ai/pipeline/canonical.server";
import {
  ConvencaoMistaError,
  colunas,
  detectarConvencao,
  detectarPeriodo,
  extrairParcela,
  lancamentos,
  lerValor,
  paresDeEstorno,
  resolverAno,
  TipoLinha,
  tipar,
  valoresDaLinha,
  valoresIncompativeis,
  type DocumentoTipado,
} from "@/integrations/ai/pipeline/typing";

const HOJE = new Date("2026-02-20T12:00:00Z");
const encoder = new TextEncoder();

async function tiparTexto(texto: string): Promise<DocumentoTipado> {
  const documento = await canonizar({ nome: "doc.txt", bytes: encoder.encode(texto) });
  return tipar(documento, { hoje: HOJE });
}

async function fixtureTipada(): Promise<DocumentoTipado> {
  const bytes = new Uint8Array(await Bun.file("test/fixtures/fatura-sicoob.txt").arrayBuffer());
  return tipar(await canonizar({ nome: "fatura-sicoob.txt", bytes }), { hoje: HOJE });
}

describe("camada 2 — convenção numérica", () => {
  test("o padrão americano num documento brasileiro é lido como americano", () => {
    expect(detectarConvencao(["TOTAL A PAGAR R$ 6,598.58", "04 JAN PADARIA R$ 29.90"])).toBe("us");
    expect(lerValor("R$ 6,598.58", "us")).toBe(6598.58);
    expect(lerValor("R$ 29.90", "us")).toBe(29.9);
  });

  test("o padrão brasileiro continua sendo lido como brasileiro", () => {
    expect(detectarConvencao(["TOTAL A PAGAR R$ 6.598,58", "04 JAN PADARIA R$ 29,90"])).toBe("br");
    expect(lerValor("R$ 6.598,58", "br")).toBe(6598.58);
    expect(lerValor("R$ 29,90", "br")).toBe(29.9);
  });

  test("sem separador de milhar não há o que decidir", () => {
    expect(detectarConvencao(["04 JAN PADARIA 29,90", "05 JAN POSTO 300,00"])).toBe("br");
    expect(detectarConvencao(["04 JAN PADARIA 29 unidades"])).toBe("indeterminada");
    expect(lerValor("29,90", "indeterminada")).toBe(29.9);
    expect(lerValor("29.90", "indeterminada")).toBe(29.9);
  });

  test("dois valores com milhar em convenções opostas levantam erro", () => {
    // "1.690,11" contra "1,690.11" é extração quebrada; a maioria só esconderia.
    expect(() => detectarConvencao(["FATURA ANTERIOR R$ 1.690,11", "TOTAL R$ 1,000.00"])).toThrow(
      ConvencaoMistaError,
    );
  });

  test("número que não é dinheiro não vota na convenção", () => {
    // O caso real que derrubou uma fatura: "1.690,11" no total e um "2.0"
    // solto num rodapé. Centavos têm dois dígitos; "2.0" não é valor.
    expect(detectarConvencao(["FATURA 1.690,11", "Mastercard 2.0"])).toBe("br");
    // Taxa de juros e compra em moeda estrangeira também não definem convenção.
    expect(detectarConvencao(["TOTAL 6,598.58", "juros de 2,38% a.m."])).toBe("us");
    expect(detectarConvencao(["TOTAL 1.690,11", "US$ 25.90 CONVERTIDO"])).toBe("br");
  });

  test("decimal solto contra evidência forte não derruba o documento", () => {
    // O documento é brasileiro pelo "1.690,11"; o "25.90" avulso vira alerta
    // de sanidade (camada 4), não erro — e ainda é lido como está escrito.
    expect(detectarConvencao(["TOTAL R$ 1.690,11", "COMPRA EXTERIOR 25.90"])).toBe("br");
    expect(valoresIncompativeis("COMPRA EXTERIOR 25.90", "br")).toEqual(["25.90"]);
    expect(lerValor("25.90", "br")).toBe(25.9);
    expect(lerValor("29,90", "us")).toBe(29.9);
  });

  test("empate só entre decimais soltos não decide nem quebra", () => {
    // Sem milhar em jogo, o último separador lê cada valor do jeito certo.
    expect(detectarConvencao(["PADARIA 29,90", "AMAZON US 25.90"])).toBe("indeterminada");
  });

  test("CNPJ e CPF não votam na convenção", () => {
    expect(detectarConvencao(["CNPJ 12.345.678/0001-90 CPF 123.456.789-01"])).toBe("indeterminada");
  });

  test("valor escrito na outra convenção é apontado linha a linha", () => {
    expect(valoresIncompativeis("04 JAN PADARIA R$ 1.234,56", "us")).toEqual(["1.234,56"]);
    expect(valoresIncompativeis("04 JAN PADARIA R$ 1,234.56", "us")).toEqual([]);
  });

  test("valor sem separador de milhar é valor do mesmo jeito", () => {
    // Extrato OFX e CSV cru escrevem "1200.00", sem agrupar o milhar.
    expect(lerValor("1200.00", "us")).toBe(1200);
    expect(lerValor("1200,00", "br")).toBe(1200);
    expect(valoresDaLinha("TRNAMT=1200.00 | NAME=SALARIO", "us")).toEqual([1200]);
    expect(detectarConvencao(["PADARIA 1200,00", "POSTO 35,90"])).toBe("br");
  });

  test("o sinal do estorno é lido de onde estiver", () => {
    expect(valoresDaLinha("04 JAN ESTORNO R$ -29.90", "us")).toEqual([-29.9]);
    expect(valoresDaLinha("04 JAN ESTORNO -R$ 29.90", "us")).toEqual([-29.9]);
    expect(valoresDaLinha("04 JAN ESTORNO (29.90)", "us")).toEqual([-29.9]);
    expect(valoresDaLinha("04 JAN ESTORNO 29.90-", "us")).toEqual([-29.9]);
    expect(valoresDaLinha("04 JAN COMPRA R$ 29.90", "us")).toEqual([29.9]);
  });
});

describe("camada 2 — datas", () => {
  test("mês depois do fechamento é do ano anterior", () => {
    const periodo = detectarPeriodo(["Vencimento: 10/02/2026"], HOJE);
    expect(periodo).toMatchObject({ fechamentoMes: 2, fechamentoAno: 2026 });
    expect(resolverAno(1, periodo)).toBe(2026);
    expect(resolverAno(2, periodo)).toBe(2026);
    expect(resolverAno(7, periodo)).toBe(2025);
    expect(resolverAno(12, periodo)).toBe(2025);
  });

  test("sem nenhuma data completa, o fechamento é hoje", () => {
    expect(detectarPeriodo(["04 JAN PADARIA 29,90"], HOJE)).toMatchObject({
      inicio: null,
      fim: null,
      fechamentoMes: 2,
      fechamentoAno: 2026,
    });
  });

  test("a data crua fica ao lado da resolvida", async () => {
    const documento = await tiparTexto(
      ["Vencimento: 10/02/2026", "17 JUL  INDUSTRIA DE JOIAS C  CHAPECO  R$ 110,00"].join("\n"),
    );
    const linha = lancamentos(documento)[0]!;
    expect(linha.dataRaw).toBe("17 JUL");
    expect(linha.dataIso).toBe("2025-07-17");
  });
});

describe("camada 2 — parcela e estorno", () => {
  test("o sufixo NN/NN é parcela, e sai da descrição", async () => {
    const documento = await tiparTexto(
      ["Vencimento: 10/02/2026", "07 JAN  D CERUTTI  01/02  Maravilha  R$ 169,00"].join("\n"),
    );
    const linha = lancamentos(documento)[0]!;

    expect(linha.parcela).toEqual({ numero: 1, total: 2 });
    expect(linha.descricao).toBe("D CERUTTI");
    expect(linha.valor).toBe(169);
    expect(linha.dataIso).toBe("2026-01-07");
  });

  test("a data do começo da linha nunca vira parcela", () => {
    expect(extrairParcela("05/01/2026 PADARIA")).toBeNull();
    expect(extrairParcela("AIRBNB * HMZPBW44PAV 05/06")).toEqual({ numero: 5, total: 6 });
    expect(extrairParcela("PARCELA 1/1")).toBeNull();
  });

  test("estorno tem flag própria e reencontra o lançamento que anula", async () => {
    const documento = await fixtureTipada();
    const estornos = lancamentos(documento).filter((linha) => linha.estorno);

    expect(estornos).toHaveLength(1);
    expect(estornos[0]).toMatchObject({ valor: -29.9, descricao: "PG *PAGTRUST TECNOLO" });

    const pares = paresDeEstorno(documento);
    expect(pares).toHaveLength(1);
    expect(pares[0]![0].valor).toBe(29.9);
    expect(pares[0]![1].valor).toBe(-29.9);
    expect(pares[0]![0].dataIso).toBe(pares[0]![1].dataIso);
  });
});

describe("camada 2 — tipagem", () => {
  test("a soma das linhas por tipo é o total de linhas do documento", async () => {
    const canonico = await canonizar({
      nome: "fatura-sicoob.txt",
      bytes: new Uint8Array(await Bun.file("test/fixtures/fatura-sicoob.txt").arrayBuffer()),
    });
    const documento = tipar(canonico, { hoje: HOJE });

    const soma = Object.values(documento.contagemPorTipo).reduce((a, b) => a + b, 0);
    expect(soma).toBe(canonico.linhas.length);
    expect(documento.linhas.map((linha) => linha.id)).toEqual(
      canonico.linhas.map((linha) => linha.id),
    );
  });

  test("valor com data é lançamento; valor sem data é total declarado", async () => {
    const documento = await fixtureTipada();
    const porTexto = (trecho: string) =>
      documento.linhas.find((linha) => linha.texto.includes(trecho))!;

    expect(porTexto("VIPI SUPERMERCADOS").tipo).toBe(TipoLinha.LANCAMENTO);
    expect(porTexto("TOTAL FINAL 5249").tipo).toBe(TipoLinha.TOTAL_DECLARADO);
    expect(porTexto("FATURA ANTERIOR").tipo).toBe(TipoLinha.TOTAL_DECLARADO);
    expect(porTexto("COMPRAS DO PERIODO").tipo).toBe(TipoLinha.TOTAL_DECLARADO);
    expect(porTexto("DESCRICAO").tipo).toBe(TipoLinha.CABECALHO);
    expect(porTexto("PORTADOR BELTRANA").tipo).toBe(TipoLinha.MARCADOR_GRUPO);
    expect(porTexto("Ouvidoria").tipo).toBe(TipoLinha.RUIDO);
    expect(porTexto("comprovante fiscal").tipo).toBe(TipoLinha.RUIDO);
  });

  test("cada linha carrega o marcador de grupo que está valendo", async () => {
    const documento = await fixtureTipada();
    const marcador = (id: number | null) =>
      documento.linhas.find((linha) => linha.id === id)?.texto ?? null;

    const vipi = documento.linhas.find((linha) => linha.texto.includes("VIPI"))!;
    expect(marcador(vipi.grupo)).toContain("FINAL 9661");

    const anuidade = documento.linhas.find((linha) => linha.texto.includes("ANUIDADE"))!;
    expect(marcador(anuidade.grupo)).toBe("MOVIMENTACOES DA CONTA");
  });

  test("descrição quebrada em duas linhas vira um lançamento só", async () => {
    const documento = await tiparTexto(
      ["Vencimento: 10/02/2026", "17 JUL   INDUSTRIA DE JOIAS C", "06/10  CHAPECO  R$ 110,00"].join(
        "\n",
      ),
    );

    const entradas = lancamentos(documento);
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({
      dataIso: "2025-07-17",
      valor: 110,
      descricao: "INDUSTRIA DE JOIAS C",
      parcela: { numero: 6, total: 10 },
      absorve: [3],
    });
    expect(documento.linhas[2]).toMatchObject({ tipo: TipoLinha.LANCAMENTO, absorvidaPor: 2 });
  });

  test("linha não resolvida vira AMBIGUA, nunca lixo", async () => {
    const documento = await tiparTexto(
      ["Vencimento: 10/02/2026", "Titular: FULANO DE TAL"].join("\n"),
    );
    expect(documento.linhas[1]!.tipo).toBe(TipoLinha.AMBIGUA);
  });

  test("colunas saem do espaçamento reconstruído pela camada 1", () => {
    expect(colunas("04 JAN   PADARIA CENTRAL   CHAPECO   R$ 12,50")).toEqual([
      "04 JAN",
      "PADARIA CENTRAL",
      "CHAPECO",
      "R$ 12,50",
    ]);
    expect(colunas("04/01/2026 | PADARIA | 12,50")).toEqual(["04/01/2026", "PADARIA", "12,50"]);
  });
});

describe("camada 2 — sem conhecimento de emissor", () => {
  test("nenhum nome de banco aparece nas camadas 1 e 2", async () => {
    const fontes = await Promise.all(
      [
        "src/integrations/ai/pipeline/canonical.server.ts",
        "src/integrations/ai/pipeline/typing.ts",
      ].map((caminho) => Bun.file(caminho).text()),
    );

    const emissores = /sicoob|ita[úu]|nubank|bradesco|santander|banco do brasil|amex/i;
    // A comparação é por booleano para o relatório de falha não despejar o
    // arquivo inteiro quando um nome escapar para o código.
    expect(fontes.map((fonte) => emissores.test(fonte))).toEqual([false, false]);
  });
});

describe("camada 2 — lançamento repartido em várias linhas", () => {
  test("o nome que ficou na linha de cima é absorvido pelo lançamento", async () => {
    const documento = await tiparTexto(
      [
        "VENCIMENTO 11 AGO 2026",
        "MOVIMENTACOES DA CONTA",
        "05 JUL   BEM POPULAR DO BRASIL   Maravilha   R$ 49,90",
        "ANUIDADE CARTAO",
        "04 MAI                                      R$ 72,00",
        "(5249) 03/12",
      ].join("\n"),
    );

    const entradas = lancamentos(documento);
    expect(entradas).toHaveLength(2);
    expect(entradas[1]).toMatchObject({
      descricao: "ANUIDADE CARTAO",
      valor: 72,
      dataIso: "2026-05-04",
      parcela: { numero: 3, total: 12 },
    });
    // O nome e a cauda viram parte do lançamento, nunca marcador de grupo.
    expect(documento.linhas.filter((l) => l.absorvidaPor === entradas[1]!.id)).toHaveLength(2);
    // E o marcador de verdade continua marcador.
    const marcador = documento.linhas.find((l) => l.texto === "MOVIMENTACOES DA CONTA")!;
    expect(marcador.tipo).toBe(TipoLinha.MARCADOR_GRUPO);
  });

  test("nome quebrado no conectivo junta as duas linhas de cima", async () => {
    const documento = await tiparTexto(
      [
        "VENCIMENTO 11 AGO 2026",
        "PROTECAO PERDA OU",
        "ROUBO",
        "04 MAI                                      R$ 4,99",
      ].join("\n"),
    );

    expect(lancamentos(documento)[0]).toMatchObject({
      descricao: "PROTECAO PERDA OU ROUBO",
      valor: 4.99,
    });
  });

  test("cidade sozinha não vira descrição quando o nome está na linha de cima", async () => {
    const normais = Array.from(
      { length: 7 },
      (_, i) => `0${i + 1} JUL   LOJA NUMERO ${i + 1}   MARAVILHA   R$ 1${i},00`,
    );
    const documento = await tiparTexto(
      [
        "VENCIMENTO 11 AGO 2026",
        ...normais,
        "MERCADOPAGO*QUATROP",
        "01 JAN                             JUIZ DE FORA   R$ 50,25",
      ].join("\n"),
    );

    const ultima = lancamentos(documento).at(-1)!;
    expect(ultima).toMatchObject({ descricao: "MERCADOPAGO*QUATROP", valor: 50.25 });
  });

  test("sobra de parcela em linha própria não rouba o valor do lançamento de baixo", async () => {
    const documento = await tiparTexto(
      [
        "VENCIMENTO 11 AGO 2026",
        "20 JUL   LOJA DO CENTRO   Pinhalzinho   R$ 65,97",
        "01/02",
        "21 JUL   MERCADO GERAL    CURITIBA      R$ 163,87",
      ].join("\n"),
    );

    const entradas = lancamentos(documento);
    expect(entradas).toHaveLength(2);
    // A sobra "01/02" pertence ao lançamento de cima, como parcela…
    expect(entradas[0]).toMatchObject({
      descricao: "LOJA DO CENTRO",
      valor: 65.97,
      parcela: { numero: 1, total: 2 },
    });
    // …e o de baixo continua inteiro, com a própria data e o próprio valor.
    expect(entradas[1]).toMatchObject({
      descricao: "MERCADO GERAL",
      valor: 163.87,
      dataIso: "2026-07-21",
      parcela: null,
    });
  });

  test("a descrição em branco fica em branco — não vira o próprio valor", async () => {
    const documento = await tiparTexto(
      ["VENCIMENTO 11 AGO 2026", "", "04 MAI                             R$ 72,00"].join("\n"),
    );
    expect(lancamentos(documento)[0]!.descricao).toBe("");
  });
});

describe("camada 2 — período com rótulos e datas por extenso", () => {
  test("vencimento e referência saem das linhas que os anunciam", () => {
    const periodo = detectarPeriodo(
      [
        "Consulta realizada em: 31/08/2026 às 19:22",
        "VENCIMENTO             11 AGO 2026",
        "REF 1 JUL A 1 AGO",
      ],
      HOJE,
    );

    expect(periodo.vencimento).toBe("2026-08-11");
    expect(periodo.inicio).toBe("2026-07-01");
    expect(periodo.fim).toBe("2026-08-01");
    // O fechamento vem do vencimento, não da maior data solta do documento.
    expect(periodo).toMatchObject({ fechamentoMes: 8, fechamentoAno: 2026 });
  });

  test("compra do ciclo não é anterior ao período: os alertas somem", async () => {
    const documento = await tiparTexto(
      [
        "VENCIMENTO 11 AGO 2026",
        "REF 1 JUL A 1 AGO",
        "05 JUL   PADARIA DA ESQUINA   MARAVILHA   R$ 12,50",
        "28 JUL   POSTO BANDEIRA       MARAVILHA   R$ 300,00",
      ].join("\n"),
    );
    const { datasNoPeriodo } = await import("@/integrations/ai/pipeline/reconcile");

    expect(datasNoPeriodo.verificar({ documento, lancamentos: lancamentos(documento) })).toEqual(
      [],
    );
  });
});

describe("camada 2 — extrato bancário com letras D/C", () => {
  test("a letra marca o sinal: D é débito, C é crédito", () => {
    expect(valoresDaLinha("10/07  PIX RECEBIDO JOAO   1.234,56 C", "br")).toEqual([1234.56]);
    expect(valoresDaLinha("11/07  BOLETO ENERGIA        200,00 D", "br")).toEqual([-200]);
    // "D" de "DE" ou de palavra qualquer não é marcador de débito.
    expect(valoresDaLinha("11/07  TAXA 200,00 DEBITADA EM CONTA", "br")).toEqual([200]);
  });

  test("o documento marcado com D/C é reconhecido; a fatura comum, não", async () => {
    const { usaMarcadorDC } = await import("@/integrations/ai/pipeline/typing");

    const extrato = await tiparTexto(
      [
        "EXTRATO DE CONTA CORRENTE",
        "Período: 05/07 a 04/08",
        "10/07/2026  PIX RECEBIDO JOAO      1.234,56 C",
        "11/07/2026  BOLETO ENERGIA          200,00 D",
        "12/07/2026  COMPRA CARTAO SUPERM     89,90 D",
      ].join("\n"),
    );
    expect(usaMarcadorDC(extrato)).toBe(true);

    const fatura = await tiparTexto(await Bun.file("test/fixtures/fatura-sicoob.txt").text());
    expect(usaMarcadorDC(fatura)).toBe(false);
  });

  test("período numérico sem ano é resolvido contra o fechamento", () => {
    const periodo = detectarPeriodo(["VENCIMENTO 11/08/2026", "Período: 05/07 a 04/08"], HOJE);
    expect(periodo.inicio).toBe("2026-07-05");
    expect(periodo.fim).toBe("2026-08-04");
    expect(periodo.vencimento).toBe("2026-08-11");
  });
});
