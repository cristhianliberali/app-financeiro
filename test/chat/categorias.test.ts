import { describe, expect, test } from "bun:test";

import { casarCategoria, normalizar, type CategoriaRef } from "@/integrations/ai/chat/categorias";

function categoria(over: Partial<CategoriaRef> & { name: string }): CategoriaRef {
  return {
    id: over.name.toLowerCase(),
    kind: "expense",
    color: "#000000",
    monthly_cap: null,
    description: null,
    archived_at: null,
    ...over,
  };
}

const CATEGORIAS: CategoriaRef[] = [
  categoria({ name: "Alimentação", description: "MERCADO, IFOOD, PADARIA, RESTAURANTE" }),
  categoria({ name: "Transporte", description: "UBER, POSTO, COMBUSTIVEL" }),
  categoria({ name: "Moradia", monthly_cap: 3000 }),
  categoria({ name: "Salário", kind: "income" }),
  categoria({ name: "Pets", archived_at: "2026-01-01T00:00:00Z" }),
];

describe("normalizar", () => {
  test("tira acento, caixa e espaço sobrando", () => {
    expect(normalizar("  Alimentação  ")).toBe("alimentacao");
    expect(normalizar("SALÁRIO")).toBe("salario");
  });
});

describe("casarCategoria", () => {
  test("nome igual, ignorando acento e caixa", () => {
    expect(casarCategoria("alimentacao", CATEGORIAS)?.name).toBe("Alimentação");
    expect(casarCategoria("ALIMENTAÇÃO", CATEGORIAS)?.name).toBe("Alimentação");
  });

  test("palavra-chave da descrição casa o que a pessoa realmente escreve", () => {
    expect(casarCategoria("mercado", CATEGORIAS)?.name).toBe("Alimentação");
    expect(casarCategoria("uber", CATEGORIAS)?.name).toBe("Transporte");
  });

  test("nome contido nos dois sentidos", () => {
    expect(casarCategoria("Alimentação e bebidas", CATEGORIAS)?.name).toBe("Alimentação");
  });

  test("sem correspondência devolve null em vez de um palpite", () => {
    expect(casarCategoria("viagem para a praia", CATEGORIAS)).toBeNull();
    expect(casarCategoria(null, CATEGORIAS)).toBeNull();
    expect(casarCategoria("   ", CATEGORIAS)).toBeNull();
  });

  test("o lado do lançamento filtra: 'salário' não é despesa", () => {
    expect(casarCategoria("Salário", CATEGORIAS, { kind: "expense" })).toBeNull();
    expect(casarCategoria("Salário", CATEGORIAS, { kind: "income" })?.name).toBe("Salário");
  });

  test("arquivada só aparece na consulta, nunca no lançamento novo", () => {
    expect(casarCategoria("Pets", CATEGORIAS)).toBeNull();
    expect(casarCategoria("Pets", CATEGORIAS, { incluirArquivadas: true })?.name).toBe("Pets");
  });
});
