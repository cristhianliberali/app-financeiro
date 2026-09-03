import { describe, expect, test } from "bun:test";

import { brl } from "@/lib/format";
import {
  ChatContractError,
  parseIntent,
  resolveData,
  resolvePeriodo,
  resumoConsulta,
  tetoDoPeriodo,
  type ConsultaResult,
} from "@/lib/chat-contract";

describe("parseIntent", () => {
  test("consulta com categoria e mês específico", () => {
    expect(
      parseIntent({
        acao: "consultar",
        metrica: "gastos",
        categoria: "Alimentação",
        periodo: { tipo: "mes", valor: "2026-03" },
      }),
    ).toEqual({
      acao: "consultar",
      metrica: "gastos",
      categoria: "Alimentação",
      periodo: { tipo: "mes", valor: "2026-03" },
    });
  });

  test("registro simples cai no padrão: em aberto e sem parcelas", () => {
    const intent = parseIntent({
      acao: "registrar",
      lancamento: {
        descricao: "Mercado",
        valor: 158,
        natureza: "expense",
        categoria: "Alimentação",
        data: { tipo: "hoje" },
        pago: false,
        parcelas: null,
      },
    });
    expect(intent).toEqual({
      acao: "registrar",
      lancamento: {
        descricao: "Mercado",
        valor: 158,
        natureza: "expense",
        categoria: "Alimentação",
        data: { tipo: "hoje" },
        pago: false,
        parcelas: null,
      },
    });
  });

  test("valor em texto com vírgula vira número", () => {
    const intent = parseIntent({
      acao: "registrar",
      lancamento: {
        descricao: "Padaria",
        valor: "23,90",
        natureza: "expense",
        categoria: null,
        data: { tipo: "ontem" },
        pago: true,
        parcelas: null,
      },
    });
    expect(intent).toMatchObject({ lancamento: { valor: 23.9, pago: true } });
  });

  test("valor negativo é sempre gravado positivo — o lado quem diz é a natureza", () => {
    const intent = parseIntent({
      acao: "registrar",
      lancamento: {
        descricao: "Estorno",
        valor: -50,
        natureza: "income",
        categoria: null,
        data: { tipo: "hoje" },
        pago: false,
        parcelas: null,
      },
    });
    expect(intent).toMatchObject({ lancamento: { valor: 50, natureza: "income" } });
  });

  test("`pago` só é verdadeiro quando vem exatamente true", () => {
    const intent = parseIntent({
      acao: "registrar",
      lancamento: {
        descricao: "Aluguel",
        valor: 1200,
        natureza: "expense",
        categoria: null,
        data: { tipo: "hoje" },
        pago: "sim",
        parcelas: null,
      },
    });
    expect(intent).toMatchObject({ lancamento: { pago: false } });
  });

  test("intervalo invertido é ordenado em vez de virar período vazio", () => {
    expect(
      parseIntent({
        acao: "consultar",
        metrica: "saldo",
        categoria: null,
        periodo: { tipo: "intervalo", de: "2026-03-31", ate: "2026-03-01" },
      }),
    ).toMatchObject({ periodo: { tipo: "intervalo", de: "2026-03-01", ate: "2026-03-31" } });
  });

  test("recusa o que está fora do contrato", () => {
    expect(() => parseIntent({ acao: "apagar" })).toThrow(ChatContractError);
    expect(() =>
      parseIntent({
        acao: "consultar",
        metrica: "lucro",
        categoria: null,
        periodo: { tipo: "mes_atual" },
      }),
    ).toThrow(ChatContractError);
    // Consulta sem período não responde nada: o contrato exige a referência.
    expect(() => parseIntent({ acao: "consultar", metrica: "gastos", categoria: null })).toThrow(
      ChatContractError,
    );
    // Valor zero ou ausente é pergunta a fazer, não lançamento a registrar.
    expect(() =>
      parseIntent({
        acao: "registrar",
        lancamento: {
          descricao: "Mercado",
          valor: 0,
          natureza: "expense",
          categoria: null,
          data: { tipo: "hoje" },
          pago: false,
          parcelas: null,
        },
      }),
    ).toThrow(ChatContractError);
    expect(() => parseIntent("{}")).toThrow(ChatContractError);
  });

  test("recusa parcelamento fora da faixa aceita pelo formulário", () => {
    const lancamento = {
      descricao: "Notebook",
      valor: 3000,
      natureza: "expense",
      categoria: null,
      data: { tipo: "hoje" },
      pago: false,
    };
    expect(() =>
      parseIntent({ acao: "registrar", lancamento: { ...lancamento, parcelas: 99 } }),
    ).toThrow(ChatContractError);
    expect(
      parseIntent({ acao: "registrar", lancamento: { ...lancamento, parcelas: 10 } }),
    ).toMatchObject({ lancamento: { parcelas: 10 } });
  });
});

describe("resolvePeriodo", () => {
  const hoje = "2026-09-03";

  test("mês atual é o mês inteiro de hoje", () => {
    expect(resolvePeriodo({ tipo: "mes_atual" }, hoje)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      label: "setembro de 2026",
    });
  });

  test("mês anterior atravessa a virada do ano", () => {
    expect(resolvePeriodo({ tipo: "mes_anterior" }, "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
      label: "dezembro de 2025",
    });
  });

  test("os últimos N dias incluem hoje", () => {
    expect(resolvePeriodo({ tipo: "ultimos_dias", valor: 7 }, hoje)).toMatchObject({
      from: "2026-08-28",
      to: "2026-09-03",
    });
  });

  test("ano inteiro vai de janeiro a dezembro", () => {
    expect(resolvePeriodo({ tipo: "ano", valor: "2025" }, hoje)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      label: "2025",
    });
  });
});

describe("resolveData", () => {
  test("hoje, ontem e dias atrás saem do calendário, não do modelo", () => {
    expect(resolveData({ tipo: "hoje" }, "2026-09-03")).toBe("2026-09-03");
    expect(resolveData({ tipo: "ontem" }, "2026-09-03")).toBe("2026-09-02");
    expect(resolveData({ tipo: "dias_atras", valor: 3 }, "2026-09-03")).toBe("2026-08-31");
    // A virada de mês e a de ano são o caso que um modelo erraria calculando.
    expect(resolveData({ tipo: "ontem" }, "2026-01-01")).toBe("2025-12-31");
    expect(resolveData({ tipo: "data", valor: "2026-02-14" }, "2026-09-03")).toBe("2026-02-14");
  });
});

describe("tetoDoPeriodo", () => {
  const setembro = { from: "2026-09-01", to: "2026-09-30", label: "setembro de 2026" };

  test("mês inteiro devolve o teto mensal cheio", () => {
    expect(tetoDoPeriodo(350, setembro)).toBeCloseTo(350, 6);
  });

  test("período parcial rateia o teto pelos dias", () => {
    const quinzena = { from: "2026-09-01", to: "2026-09-15", label: "quinzena" };
    expect(tetoDoPeriodo(300, quinzena)).toBeCloseTo(150, 6);
  });

  test("sem teto mensal não há teto de período", () => {
    expect(tetoDoPeriodo(null, setembro)).toBeNull();
    expect(tetoDoPeriodo(0, setembro)).toBeNull();
  });
});

describe("resumoConsulta", () => {
  const base: ConsultaResult = {
    metrica: "gastos",
    periodo: { from: "2026-09-01", to: "2026-09-30", label: "setembro de 2026" },
    categoria: { id: "c1", name: "Alimentação", color: "#F97316", monthlyCap: 350 },
    categoriaNaoEncontrada: null,
    entradas: 0,
    saidas: 100,
    saldo: -100,
    lancamentos: 4,
    teto: 350,
    porCategoria: [],
  };

  test("gasto com teto responde o quanto foi e o quanto cabe", () => {
    const texto = resumoConsulta(base);
    expect(texto).toContain(brl(100.0));
    expect(texto).toContain(brl(350.0));
    expect(texto).toContain("Alimentação");
    expect(texto).toContain("Ainda cabem");
  });

  test("acima do teto o texto muda de lado", () => {
    expect(resumoConsulta({ ...base, saidas: 400, saldo: -400 })).toContain("acima do teto");
  });

  test("saldo mostra os dois lados e a diferença", () => {
    const texto = resumoConsulta({
      ...base,
      metrica: "saldo",
      categoria: null,
      teto: null,
      entradas: 3000,
      saidas: 1200,
      saldo: 1800,
    });
    expect(texto).toContain(brl(3000.0));
    expect(texto).toContain(brl(1200.0));
    expect(texto).toContain(brl(1800.0));
  });

  test("categoria inexistente é dita, e o total do período responde no lugar", () => {
    const texto = resumoConsulta({
      ...base,
      categoria: null,
      categoriaNaoEncontrada: "Pets",
      teto: null,
    });
    expect(texto).toContain("Pets");
    expect(texto).toContain(brl(100.0));
  });

  test("período sem lançamento diz isso em vez de mostrar só um zero", () => {
    expect(
      resumoConsulta({ ...base, saidas: 0, saldo: 0, lancamentos: 0, teto: null, categoria: null }),
    ).toContain("Não há nenhum lançamento");
  });
});
