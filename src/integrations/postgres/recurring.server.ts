/**
 * Recorrências que viram lançamentos de verdade.
 *
 * Antes a regra era só projeção: os gráficos somavam o valor dela, mas nenhum
 * lançamento existia. Isso quebra assim que se olha para trás ("cadê os oito
 * meses de aluguel que já venceram?") e para a frente ("o que tenho a pagar em
 * março?"). Agora a regra materializa a série inteira — do início dela até um
 * horizonte que anda sozinho.
 *
 * Duas propriedades sustentam o resto:
 *
 *   - a geração é idempotente. Um índice único por (regra, vencimento) e um
 *     `ON CONFLICT DO NOTHING` fazem com que rodar de novo não duplique nada,
 *     mesmo se duas requisições rodarem ao mesmo tempo;
 *   - a regra lembra até onde já gerou (`materialized_until`), então a rotina
 *     que completa o horizonte quase sempre não tem trabalho nenhum.
 *
 * Excluir a regra não decide sozinho o destino dos lançamentos: a coluna é
 * `ON DELETE SET NULL` no banco, e quem escolhe é a pessoa, na confirmação.
 */
import type { PoolClient } from "pg";

import { query, queryOne, withTransaction } from "./client.server";
import { requireProfileAccess, requireRowAccess } from "./access.server";
import { occurrencesUntil, recurringHorizon } from "@/lib/recurring";

/**
 * Teto de ocorrências por regra.
 *
 * Uma semanal desde 2015 com horizonte de dois anos passa de quinhentas linhas;
 * o teto existe para que uma data de início digitada errada (1900, por engano)
 * não vire dez mil lançamentos.
 */
const MAX_OCCURRENCES_PER_RULE = 600;

type RuleRow = {
  id: string;
  profile_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  kind: "income" | "expense";
  frequency: "monthly" | "weekly" | "yearly";
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  materialized_until: string | null;
  variable_amount: boolean;
};

const RULE_COLUMNS =
  "id, profile_id, category_id, description, amount, kind, frequency, day_of_month, " +
  "start_date, end_date, materialized_until, variable_amount";

/** Erro do Postgres de coluna que não existe — banco sem o `db:migrate` novo. */
function isMissingColumn(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "42703"
  );
}

let avisouColuna = false;

function avisarBancoAntigo(): void {
  if (avisouColuna) return;
  avisouColuna = true;
  console.error(
    "[recorrência] o banco ainda não tem as colunas da série recorrente — rode `bun run db:migrate`",
  );
}

/**
 * Cria os lançamentos que faltam para uma regra, até `until`.
 *
 * Sem categoria não gera nada: lançamento sem categoria é recusado no resto do
 * app, e criar aqui pelas costas dessa regra deixaria o banco inconsistente com
 * o que qualquer formulário aceita.
 */
async function materializeRule(
  client: PoolClient,
  userId: string,
  rule: RuleRow,
  until: string,
): Promise<number> {
  if (!rule.category_id) return 0;

  /*
   * Recomeça de onde parou, não do início da regra. Na primeira vez
   * `materialized_until` é nulo e a série nasce inteira, incluindo o passado —
   * é o "para trás com base na data de início".
   */
  const desde =
    rule.materialized_until && rule.materialized_until > rule.start_date
      ? rule.materialized_until
      : rule.start_date;

  const dates = occurrencesUntil(
    {
      frequency: rule.frequency,
      day_of_month: rule.day_of_month,
      start_date: desde,
      end_date: rule.end_date,
    },
    until,
    MAX_OCCURRENCES_PER_RULE,
  );

  let criados = 0;
  for (const date of dates) {
    const inserted = await client.query(
      `INSERT INTO transactions
         (user_id, profile_id, category_id, description, amount, kind,
          transaction_date, due_date, status, recurring_rule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'pending', $8)
       ON CONFLICT (recurring_rule_id, due_date) WHERE recurring_rule_id IS NOT NULL
       DO NOTHING`,
      [
        userId,
        rule.profile_id,
        rule.category_id,
        rule.description,
        rule.amount,
        rule.kind,
        date,
        rule.id,
      ],
    );
    criados += inserted.rowCount ?? 0;
  }

  await client.query(`UPDATE recurring_rules SET materialized_until = $2 WHERE id = $1`, [
    rule.id,
    until,
  ]);

  return criados;
}

/**
 * Completa a série de todas as regras ativas do perfil até o horizonte.
 *
 * É chamada quando as transações são lidas, e é o que faz o "para sempre à
 * frente" acontecer sem nenhuma rotina de fundo: cada vez que alguém abre uma
 * tela de Finanças, o horizonte é conferido. Na imensa maioria das vezes o
 * primeiro SELECT não devolve nada e a função termina aí.
 */
export async function ensureRecurringMaterialized(
  userId: string,
  profileId: string,
): Promise<number> {
  const until = recurringHorizon();

  let pendentes: RuleRow[];
  try {
    pendentes = await query<RuleRow>(
      `SELECT ${RULE_COLUMNS} FROM recurring_rules
        WHERE profile_id = $1 AND active
          AND category_id IS NOT NULL
          AND (materialized_until IS NULL OR materialized_until < $2)`,
      [profileId, until],
    );
  } catch (error) {
    // Deploy com o código novo e a migração ainda por rodar: o resto do app
    // continua de pé, só sem a série automática.
    if (!isMissingColumn(error)) throw error;
    avisarBancoAntigo();
    return 0;
  }
  if (pendentes.length === 0) return 0;

  return withTransaction(async (client) => {
    let criados = 0;
    for (const rule of pendentes) criados += await materializeRule(client, userId, rule, until);
    return criados;
  });
}

/** Grava a regra e já cria a série dela. Devolve quantos lançamentos nasceram. */
export async function saveRecurringRule(
  userId: string,
  input: {
    id?: string | undefined;
    profileId: string;
    categoryId: string;
    description: string;
    amount: number;
    kind: "income" | "expense";
    frequency: "monthly" | "weekly" | "yearly";
    dayOfMonth: number;
    startDate: string;
    endDate?: string | null;
    /** Valor varia a cada ocorrência: o `amount` vira estimativa. */
    variableAmount?: boolean;
  },
): Promise<{ id: string; created: number }> {
  await requireProfileAccess(userId, input.profileId, "editor");
  if (input.id) await requireRowAccess(userId, "recurring_rules", input.id, "editor");

  const until = recurringHorizon();

  return withTransaction(async (client) => {
    const saved = await client.query<RuleRow>(
      input.id
        ? `UPDATE recurring_rules
              SET profile_id = $2, category_id = $3, description = $4, amount = $5, kind = $6,
                  frequency = $7, day_of_month = $8, start_date = $9, end_date = $10,
                  variable_amount = $11, active = true,
                  -- Mudou a regra: a série precisa ser reconferida desde o começo.
                  materialized_until = NULL
            WHERE id = $1
        RETURNING ${RULE_COLUMNS}`
        : `INSERT INTO recurring_rules
             (id, user_id, profile_id, category_id, description, amount, kind, frequency,
              day_of_month, start_date, end_date, variable_amount, active)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $12, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
        RETURNING ${RULE_COLUMNS}`,
      input.id
        ? [
            input.id,
            input.profileId,
            input.categoryId,
            input.description,
            input.amount,
            input.kind,
            input.frequency,
            input.dayOfMonth,
            input.startDate,
            input.endDate ?? null,
            input.variableAmount ?? false,
          ]
        : [
            null,
            input.profileId,
            input.categoryId,
            input.description,
            input.amount,
            input.kind,
            input.frequency,
            input.dayOfMonth,
            input.startDate,
            input.endDate ?? null,
            input.variableAmount ?? false,
            userId,
          ],
    );

    const rule = saved.rows[0]!;
    const created = await materializeRule(client, userId, rule, until);
    return { id: rule.id, created };
  });
}

/** O que existe hoje de lançamentos de uma regra — o que a confirmação mostra. */
export type RuleImpact = {
  total: number;
  futuros: number;
  liquidados: number;
};

export async function recurringImpact(userId: string, ruleId: string): Promise<RuleImpact> {
  await requireRowAccess(userId, "recurring_rules", ruleId, "viewer");
  try {
    const row = await queryOne<RuleImpact>(
      `SELECT count(*)::bigint AS total,
              count(*) FILTER (WHERE due_date > CURRENT_DATE)::bigint AS futuros,
              count(*) FILTER (WHERE status = 'paid')::bigint AS liquidados
         FROM transactions WHERE recurring_rule_id = $1`,
      [ruleId],
    );
    return row ?? { total: 0, futuros: 0, liquidados: 0 };
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    avisarBancoAntigo();
    return { total: 0, futuros: 0, liquidados: 0 };
  }
}

/**
 * O que fazer com os lançamentos ao excluir a regra.
 *
 * `keep` existe porque nem toda exclusão é arrependimento: quem encerra um
 * contrato quer a regra fora do caminho e o histórico intacto.
 */
export type DeleteScope = "all" | "future" | "keep";

export async function deleteRecurringRule(
  userId: string,
  ruleId: string,
  scope: DeleteScope,
): Promise<{ removed: number }> {
  await requireRowAccess(userId, "recurring_rules", ruleId, "editor");

  return withTransaction(async (client) => {
    let removed = 0;
    if (scope !== "keep") {
      /*
       * "Futuras" é estritamente depois de hoje. O lançamento que vence hoje
       * pode já ter sido pago, e apagá-lo junto seria apagar dinheiro que saiu.
       */
      const apagados = await client.query(
        scope === "all"
          ? `DELETE FROM transactions WHERE recurring_rule_id = $1`
          : `DELETE FROM transactions WHERE recurring_rule_id = $1 AND due_date > CURRENT_DATE`,
        [ruleId],
      );
      removed = apagados.rowCount ?? 0;
    }

    // Os que ficaram perdem o vínculo pelo `ON DELETE SET NULL` e viram
    // lançamentos comuns — continuam no extrato, sem dono.
    await client.query(`DELETE FROM recurring_rules WHERE id = $1`, [ruleId]);
    return { removed };
  });
}
