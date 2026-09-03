import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * A junção das contas próprias numa só.
 *
 * O que precisa ficar de pé aqui não é o SQL bonito: é que a consolidação
 * mexa apenas no que a pessoa é dona, leve junto tudo que pendura na conta, e
 * não rode de novo depois de já ter rodado. Um erro em qualquer um dos três
 * apaga dado de alguém — o primeiro, dado de terceiro.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const PRINCIPAL = "a1111111-1111-1111-1111-111111111111";
const SOBRA = "a2222222-2222-2222-2222-222222222222";

/** Contas que o "banco" devolve como pertencentes ao usuário. */
let owned: Array<{ id: string }> = [];
/** Tudo que foi executado dentro da transação. */
let executado: Array<{ sql: string; params: readonly unknown[] }> = [];

mock.module("../src/integrations/postgres/client.server", () => ({
  query: async (sql: string) => {
    if (sql.includes("FROM accounts WHERE owner_id")) return owned;
    // A listagem precisa devolver algo: `listAccounts` sem vínculo nenhum cria
    // a conta do primeiro login, e o teste não é sobre isso.
    if (sql.includes("FROM account_members m")) {
      return [
        { id: PRINCIPAL, name: "Minha conta", color: "#3B82F6", owner_id: USER, role: "owner" },
      ];
    }
    return [];
  },
  queryOne: async () => null,
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: readonly unknown[] = []) => {
        executado.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    }),
  getPool: () => {
    throw new Error("o teste não abre conexão de verdade");
  },
}));

async function consolidar() {
  executado = [];
  const mod = await import("../src/integrations/postgres/accounts.server");
  // `listAccounts` é a porta: é ela que roda a consolidação a cada carregamento.
  await mod.listAccounts(USER, "cris@exemplo.com");
}

afterEach(() => {
  owned = [];
});

describe("consolidação das contas próprias", () => {
  test("com uma conta só, não toca em nada", async () => {
    owned = [{ id: PRINCIPAL }];
    await consolidar();
    expect(executado).toHaveLength(0);
  });

  test("sem conta nenhuma, também não", async () => {
    owned = [];
    await consolidar();
    expect(executado.some((e) => e.sql.includes("DELETE FROM accounts"))).toBe(false);
  });

  test("move tudo que pendura na conta, sem esquecer nenhuma tabela", async () => {
    owned = [{ id: PRINCIPAL }, { id: SOBRA }];
    await consolidar();

    // Se uma tabela nova passar a pendurar em `account_id` e não entrar na
    // lista, este teste é o que avisa: ela ficaria órfã no DELETE do fim.
    for (const tabela of [
      "budget_profiles",
      "spaces",
      "labels",
      "status_templates",
      "account_invites",
    ]) {
      const mudanca = executado.find(
        (e) => e.sql.includes(`UPDATE ${tabela}`) && e.sql.includes("SET account_id"),
      );
      expect(mudanca, `faltou mover ${tabela}`).toBeDefined();
      expect(mudanca!.params[0]).toBe(PRINCIPAL);
      expect(mudanca!.params[1]).toEqual([SOBRA]);
    }
  });

  test("quem tinha acesso à conta secundária continua tendo", async () => {
    owned = [{ id: PRINCIPAL }, { id: SOBRA }];
    await consolidar();
    const membros = executado.find((e) => e.sql.includes("INSERT INTO account_members"));
    expect(membros).toBeDefined();
    // Sem o `DO NOTHING`, quem já estava nas duas contas quebraria a transação
    // inteira no índice único — e a consolidação falharia justamente para quem
    // mais compartilha.
    expect(membros!.sql).toContain("DO NOTHING");
  });

  test("a conta principal é a mais antiga, e só as outras são apagadas", async () => {
    owned = [{ id: PRINCIPAL }, { id: SOBRA }, { id: "a3" }];
    await consolidar();
    const remocao = executado.find((e) => e.sql.includes("DELETE FROM accounts"));
    expect(remocao).toBeDefined();
    expect(remocao!.params[0]).toEqual([SOBRA, "a3"]);
  });

  test("apaga as contas por último, depois de esvaziá-las", async () => {
    owned = [{ id: PRINCIPAL }, { id: SOBRA }];
    await consolidar();
    const ultima = executado[executado.length - 1]!;
    expect(ultima.sql).toContain("DELETE FROM accounts");
  });
});
