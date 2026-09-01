import { describe, expect, test } from "bun:test";

import {
  canonizar,
  detectarOrigem,
  lerDelimitado,
  OcrNecessarioError,
} from "@/integrations/ai/pipeline/canonical.server";
import { makePdf, type PdfTextItem } from "../helpers/make-pdf";

const encoder = new TextEncoder();
const bytesDe = (texto: string) => encoder.encode(texto);

/** Uma linha de fatura: data, descrição, cidade e valor em colunas. */
function linhaFatura(y: number, data: string, descricao: string, cidade: string, valor: string) {
  return [
    { x: 50, y, text: data },
    { x: 110, y, text: descricao },
    // Décimos de diferença na coluna do valor, como acontece de verdade: é o
    // que a tolerância vertical precisa absorver.
    { x: 330, y: y + 0.4, text: cidade },
    { x: 470, y: y - 0.3, text: valor },
  ] satisfies PdfTextItem[];
}

const PAGINA_FATURA: PdfTextItem[] = [
  { x: 50, y: 800, text: "FATURA DO CARTAO DE CREDITO" },
  { x: 50, y: 780, text: "Vencimento: 10/02/2026" },
  ...linhaFatura(740, "04 JAN", "PG *PAGTRUST TECNOLO", "SANTANA DE PA", "R$ 29.90"),
  ...linhaFatura(720, "07 JAN", "D CERUTTI 01/02", "MARAVILHA", "R$ 169.00"),
  ...linhaFatura(700, "12 JAN", "VIPI SUPERMERCADOS E", "MARAVILHA", "R$ 251.65"),
  { x: 50, y: 660, text: "TOTAL A PAGAR" },
  { x: 470, y: 660, text: "R$ 450.55" },
];

const faturaPdf = () => ({ nome: "fatura.pdf", bytes: makePdf([PAGINA_FATURA]) });

describe("camada 1 — detecção de origem", () => {
  test("vem do conteúdo, não da extensão", async () => {
    const pdf = makePdf([[{ x: 50, y: 800, text: "x".repeat(200) }]]);
    expect(detectarOrigem(pdf)).toBe("pdf_texto");
    expect(detectarOrigem(bytesDe("OFXHEADER:100\n<OFX><BANKMSGSRSV1>"))).toBe("ofx");
    expect(detectarOrigem(bytesDe("data;descricao;valor\n04/01;PADARIA;12,50\n"))).toBe("csv");
    expect(detectarOrigem(bytesDe("uma nota qualquer\nsem estrutura"))).toBe("texto");
  });

  test("um PDF chamado .txt continua sendo lido como PDF", async () => {
    const documento = await canonizar({ nome: "fatura.txt", bytes: makePdf([PAGINA_FATURA]) });
    expect(documento.origem).toBe("pdf_texto");
  });
});

describe("camada 1 — PDF com camada de texto", () => {
  test("reprocessar o mesmo arquivo produz exatamente os mesmos ids", async () => {
    const primeira = await canonizar(faturaPdf());
    const segunda = await canonizar(faturaPdf());

    expect(segunda.linhas).toEqual(primeira.linhas);
    expect(segunda.metadados.hash).toBe(primeira.metadados.hash);
    expect(primeira.linhas.map((linha) => linha.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("nenhum conteúdo do documento some da lista canônica", async () => {
    const documento = await canonizar(faturaPdf());
    // O equivalente ao `pdftotext -layout` para uma fixture que o teste
    // escreveu: cada trecho posicionado no PDF tem de reaparecer na saída.
    const canonico = documento.linhas.map((linha) => linha.texto).join("\n");
    for (const item of PAGINA_FATURA) {
      expect(canonico).toContain(item.text);
    }
  });

  test("itens da mesma linha visual viram uma linha só, com as colunas separadas", async () => {
    const documento = await canonizar(faturaPdf());
    const lancamento = documento.linhas[2]!;

    expect(lancamento.texto).toMatch(
      /^04 JAN\s+PG \*PAGTRUST TECNOLO\s+SANTANA DE PA\s+R\$ 29\.90$/,
    );
    expect(lancamento.pagina).toBe(1);
  });

  test("o bbox cobre a linha inteira, da primeira coluna à última", async () => {
    const documento = await canonizar(faturaPdf());
    const [x0, y0, x1, y1] = documento.linhas[2]!.bbox!;

    expect(x0).toBeCloseTo(50, 1);
    expect(x1).toBeGreaterThan(470);
    // A coluna do valor está 0,3pt abaixo da data, e a cidade 0,4pt acima.
    expect(y0).toBeCloseTo(739.7, 1);
    expect(y1).toBeGreaterThan(750);
  });

  test("os ids seguem contando de uma página para a outra", async () => {
    // Duas páginas de duas linhas cada ficam abaixo do limiar de OCR, que é
    // calibrado para fatura de verdade; aqui ele sai do caminho.
    const documento = await canonizar(
      {
        nome: "duas-paginas.pdf",
        bytes: makePdf([
          [
            { x: 50, y: 800, text: "PAGINA UM DA FATURA DO CARTAO" },
            ...linhaFatura(760, "04 JAN", "PADARIA CENTRAL", "CHAPECO", "R$ 12.50"),
          ],
          [
            { x: 50, y: 800, text: "PAGINA DOIS DA FATURA DO CARTAO" },
            ...linhaFatura(760, "05 JAN", "POSTO IPIRANGA", "CHAPECO", "R$ 300.00"),
          ],
        ]),
      },
      { limiarCaracteresPorPagina: 10 },
    );

    expect(documento.linhas.map((linha) => [linha.id, linha.pagina])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
    ]);
    expect(documento.metadados.nPaginas).toBe(2);
    expect(documento.metadados.paginas[0]).toEqual({ numero: 1, largura: 595, altura: 842 });
  });

  test("PDF digitalizado é detectado e falha com a densidade medida", async () => {
    const scan = { nome: "scan.pdf", bytes: makePdf([[{ x: 50, y: 800, text: "1 de 2" }]]) };

    await expect(canonizar(scan)).rejects.toThrow(OcrNecessarioError);
    await canonizar(scan).catch((erro: OcrNecessarioError) => {
      expect(erro.caracteresPorPagina).toBe(6);
      expect(erro.message).toContain("OCR");
    });
  });

  test("o limiar de OCR é configurável", async () => {
    const documento = await canonizar(
      { nome: "curto.pdf", bytes: makePdf([[{ x: 50, y: 800, text: "1 de 2" }]]) },
      { limiarCaracteresPorPagina: 1 },
    );
    expect(documento.linhas).toHaveLength(1);
    expect(documento.metadados.caracteresPorPagina).toBe(6);
  });

  test("o hash SHA-256 do arquivo vai nos metadados", async () => {
    const documento = await canonizar(faturaPdf());
    const esperado = new Bun.CryptoHasher("sha256").update(makePdf([PAGINA_FATURA])).digest("hex");
    expect(documento.metadados.hash).toBe(esperado);
  });
});

describe("camada 1 — CSV", () => {
  test("um registro por linha, com os campos concatenados", async () => {
    const documento = await canonizar({
      nome: "extrato.csv",
      bytes: bytesDe("data;descricao;valor\n04/01/2026;PADARIA;12,50\n05/01/2026;POSTO;300,00\n"),
    });

    expect(documento.origem).toBe("csv");
    expect(documento.linhas.map((linha) => linha.texto)).toEqual([
      "data | descricao | valor",
      "04/01/2026 | PADARIA | 12,50",
      "05/01/2026 | POSTO | 300,00",
    ]);
    expect(documento.linhas.every((linha) => linha.bbox === null)).toBe(true);
  });

  test("aspas protegem delimitador e quebra de linha dentro do campo", () => {
    const registros = lerDelimitado('a,"b,c","d\ne",""""\nf,g,h,i\n', ",");
    expect(registros).toEqual([
      ["a", "b,c", "d\ne", '"'],
      ["f", "g", "h", "i"],
    ]);
  });

  test("linha em branco continua sendo uma linha", async () => {
    const documento = await canonizar({
      nome: "com-buraco.csv",
      bytes: bytesDe("a,b\n\nc,d\n"),
    });
    expect(documento.linhas.map((linha) => linha.texto)).toEqual(["a | b", "", "c | d"]);
  });
});

describe("camada 1 — OFX", () => {
  test("cabeçalho e lançamentos viram linhas, na ordem do extrato", async () => {
    const ofx = [
      "OFXHEADER:100",
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
      "<CURDEF>BRL",
      "<BANKACCTFROM><ACCTID>12345-6</ACCTID></BANKACCTFROM>",
      "<BANKTRANLIST><DTSTART>20260105</DTSTART><DTEND>20260204</DTEND>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260104<TRNAMT>-29.90",
      "<FITID>001<NAME>PG *PAGTRUST TECNOLO</STMTTRN>",
      "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260104<TRNAMT>29.90",
      "<FITID>002<NAME>ESTORNO PG *PAGTRUST</STMTTRN>",
      "</BANKTRANLIST><LEDGERBAL><BALAMT>1250.00</BALAMT></LEDGERBAL>",
      "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    ].join("\n");

    const documento = await canonizar({ nome: "extrato.ofx", bytes: bytesDe(ofx) });

    expect(documento.origem).toBe("ofx");
    expect(documento.linhas.map((linha) => linha.texto)).toEqual([
      "DTSTART=20260105",
      "DTEND=20260204",
      "ACCTID=12345-6",
      "BALAMT=1250.00",
      "CURDEF=BRL",
      "DTPOSTED=20260104 | TRNTYPE=DEBIT | TRNAMT=-29.90 | NAME=PG *PAGTRUST TECNOLO | FITID=001",
      "DTPOSTED=20260104 | TRNTYPE=CREDIT | TRNAMT=29.90 | NAME=ESTORNO PG *PAGTRUST | FITID=002",
    ]);
  });
});

describe("camada 1 — texto", () => {
  test("uma linha por linha física, inclusive as vazias", async () => {
    const documento = await canonizar({ nome: "colado.txt", bytes: bytesDe("uma\r\n\r\ndupla") });
    expect(documento.linhas.map((linha) => [linha.id, linha.texto])).toEqual([
      [1, "uma"],
      [2, ""],
      [3, "dupla"],
    ]);
  });

  test("arquivo vazio falha na hora", async () => {
    await expect(canonizar({ nome: "vazio.txt", bytes: new Uint8Array() })).rejects.toThrow(
      "arquivo enviado está vazio",
    );
  });
});

describe("camada 1 — páginas com duas colunas de lançamentos", () => {
  /** Uma linha completa de lançamento em qualquer posição da página. */
  function entrada(x: number, y: number, data: string, nome: string, valor: string) {
    return [
      { x, y, text: data },
      { x: x + 55, y, text: nome },
      { x: x + 185, y, text: valor },
    ] satisfies PdfTextItem[];
  }

  test("colunas lado a lado viram sequências separadas, na ordem de leitura", async () => {
    // Duas colunas de lançamentos na mesma altura — o layout que, agrupado só
    // por altura, cola a data de um lançamento no valor do outro.
    const documento = await canonizar(
      {
        nome: "duas-colunas.pdf",
        bytes: makePdf([
          [
            { x: 40, y: 790, text: "LANCAMENTOS DO CARTAO" },
            ...entrada(40, 750, "05 JUL", "PADARIA CENTRAL", "R$ 49,90"),
            ...entrada(310, 750, "24 JUL", "MERCADO MODELO", "R$ 29,99"),
            ...entrada(40, 730, "06 JUL", "POSTO BANDEIRA", "R$ 91,00"),
            ...entrada(310, 730, "25 JUL", "LIVRARIA CENTRAL", "R$ 45,00"),
            ...entrada(40, 710, "07 JUL", "RESTAURANTE BOM", "R$ 25,00"),
            ...entrada(310, 710, "26 JUL", "FARMACIA SAUDE", "R$ 18,50"),
            ...entrada(40, 690, "08 JUL", "MERCADO PERTO", "R$ 62,10"),
            ...entrada(310, 690, "27 JUL", "CAFE DA PRACA", "R$ 12,00"),
          ],
        ]),
      },
      { limiarCaracteresPorPagina: 10 },
    );

    const textos = documento.linhas.map((linha) => linha.texto);
    // Cada lançamento inteiro na própria linha: nada de data de um com valor do outro.
    expect(textos).toEqual([
      "LANCAMENTOS DO CARTAO",
      expect.stringMatching(/^05 JUL\s+PADARIA CENTRAL\s+R\$ 49,90$/),
      expect.stringMatching(/^06 JUL\s+POSTO BANDEIRA\s+R\$ 91,00$/),
      expect.stringMatching(/^07 JUL\s+RESTAURANTE BOM\s+R\$ 25,00$/),
      expect.stringMatching(/^08 JUL\s+MERCADO PERTO\s+R\$ 62,10$/),
      expect.stringMatching(/^24 JUL\s+MERCADO MODELO\s+R\$ 29,99$/),
      expect.stringMatching(/^25 JUL\s+LIVRARIA CENTRAL\s+R\$ 45,00$/),
      expect.stringMatching(/^26 JUL\s+FARMACIA SAUDE\s+R\$ 18,50$/),
      expect.stringMatching(/^27 JUL\s+CAFE DA PRACA\s+R\$ 12,00$/),
    ]);
  });

  test("tabela comum não é dividida: a coluna de valores sozinha não é coluna", async () => {
    // Mesma cara de vão vertical, mas o lado direito só tem valores — é uma
    // tabela de uma coluna só, e dividir aqui quebraria toda fatura simples.
    const documento = await canonizar(
      {
        nome: "uma-coluna.pdf",
        bytes: makePdf([
          [
            { x: 40, y: 790, text: "RESUMO DE VALORES DO MES DA FATURA" },
            ...[780, 760, 740, 720, 700, 680, 660, 640].flatMap((y, i) => [
              { x: 40, y, text: `0${(i % 8) + 1} JUL` },
              { x: 100, y, text: "ESTABELECIMENTO QUALQUER" },
              { x: 470, y, text: `R$ ${i + 1}0,00` },
            ]),
          ],
        ]),
      },
      { limiarCaracteresPorPagina: 10 },
    );

    expect(documento.linhas).toHaveLength(9);
    expect(documento.linhas[1]!.texto).toMatch(/^01 JUL\s+ESTABELECIMENTO QUALQUER\s+R\$ 10,00$/);
  });
});
