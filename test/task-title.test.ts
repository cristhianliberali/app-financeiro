import { describe, expect, test } from "bun:test";

import { MAX_TITULO_VISIVEL, resumirTitulo, tituloPorExtenso } from "@/lib/task-title";

/**
 * O corte do nome da tarefa nas listagens.
 *
 * O que se protege aqui é o teto: passar dele é o que quebra o layout do
 * cartão e da tabela, e é o tipo de regressão que só aparece quando alguém
 * cria uma tarefa com um nome enorme — ou seja, em produção.
 */
describe("resumirTitulo", () => {
  test("nome curto passa inteiro, sem reticências", () => {
    expect(resumirTitulo("Revisar o contrato")).toBe("Revisar o contrato");
  });

  test("no limite exato ainda passa inteiro", () => {
    const exato = "a".repeat(MAX_TITULO_VISIVEL);
    expect(resumirTitulo(exato)).toBe(exato);
    expect(resumirTitulo(exato)).toHaveLength(MAX_TITULO_VISIVEL);
  });

  test("nunca passa do teto, reticências incluídas", () => {
    // A garantia é sobre o que aparece na tela: se o "…" não coubesse na conta,
    // o teto vazaria por um caractere justamente nos títulos cortados.
    for (const tamanho of [71, 100, 500, 5000]) {
      const resumo = resumirTitulo("palavra ".repeat(tamanho));
      expect(resumo.length).toBeLessThanOrEqual(MAX_TITULO_VISIVEL);
    }
  });

  test("corta e marca com reticências", () => {
    const longo =
      "Revisar o contrato de prestação de serviços da agência antes da reunião de diretoria";
    const resumo = resumirTitulo(longo);
    expect(resumo.endsWith("…")).toBe(true);
    expect(longo.startsWith(resumo.slice(0, -1))).toBe(true);
  });

  test("prefere cortar no espaço, para não partir a palavra ao meio", () => {
    const resumo = resumirTitulo(
      "Revisar o contrato de prestação de serviços da agência antes da reunião",
    );
    // Sem o recuo, o corte cairia dentro de "reunião".
    expect(resumo).toBe("Revisar o contrato de prestação de serviços da agência antes da…");
  });

  test("palavra única e gigante é cortada no osso, sem recuar a linha toda", () => {
    const url = `https://exemplo.com/${"x".repeat(200)}`;
    const resumo = resumirTitulo(url);
    expect(resumo).toHaveLength(MAX_TITULO_VISIVEL);
    // Recuar até o último espaço deixaria a linha quase vazia.
    expect(resumo.startsWith("https://exemplo.com/")).toBe(true);
  });

  test("não deixa pontuação encostada nas reticências", () => {
    const resumo = resumirTitulo(`${"a".repeat(60)} fim, e mais coisas depois disso tudo`);
    expect(resumo).not.toContain(",…");
    expect(resumo.endsWith("…")).toBe(true);
  });

  test("espaços e quebras de linha viram um espaço só", () => {
    expect(resumirTitulo("  Revisar\n\n o   contrato  ")).toBe("Revisar o contrato");
  });
});

describe("tituloPorExtenso", () => {
  test("só devolve o nome quando ele foi cortado", () => {
    // Sem isso, toda tarefa da lista ganharia uma dica repetindo o que já se lê.
    expect(tituloPorExtenso("Revisar o contrato")).toBeUndefined();
    expect(tituloPorExtenso("a".repeat(MAX_TITULO_VISIVEL))).toBeUndefined();

    const longo = "a".repeat(MAX_TITULO_VISIVEL + 1);
    expect(tituloPorExtenso(longo)).toBe(longo);
  });

  test("concorda com resumirTitulo sobre o que foi cortado", () => {
    for (const tamanho of [1, 69, 70, 71, 200]) {
      const titulo = "a".repeat(tamanho);
      const cortado = resumirTitulo(titulo) !== titulo;
      expect(tituloPorExtenso(titulo) !== undefined).toBe(cortado);
    }
  });
});
