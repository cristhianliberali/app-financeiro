/**
 * Modelos de etapas reaproveitáveis, no nível da conta.
 *
 * Quem afina as etapas de um quadro — "Backlog, A fazer, Em revisão,
 * Concluído" — quase sempre quer as mesmas no próximo. Recriá-las à mão em cada
 * quadro é trabalho repetido, e repetido à mão sai diferente: um "Em revisão"
 * aqui, um "Revisão" ali, e os relatórios que cruzam quadros deixam de casar.
 *
 * O modelo é um retrato, não um vínculo: aplicar num quadro copia as etapas e
 * acaba ali. Mudar o quadro depois não reescreve o modelo, e mudar o modelo não
 * mexe em quadro nenhum. Vínculo vivo seria pior — renomear uma etapa no modelo
 * renomearia tarefas em quadros que ninguém estava olhando.
 */
import { query, queryOne } from "./client.server";
import { requireAccountRole } from "./access.server";

export type StatusTemplateSeed = {
  name: string;
  color: string;
  polarity: "IN_PROGRESS" | "SUCCESS" | "ARCHIVED";
};

export type StatusTemplate = {
  id: string;
  account_id: string;
  name: string;
  statuses: StatusTemplateSeed[];
  created_at: string;
};

const POLARITIES = new Set(["IN_PROGRESS", "SUCCESS", "ARCHIVED"]);

/** Erro do Postgres de tabela que não existe — banco sem o `db:migrate` novo. */
function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01"
  );
}

let avisou = false;

function avisarBancoAntigo(): void {
  if (avisou) return;
  avisou = true;
  console.error(
    "[etapas] a tabela de modelos de etapas não existe neste banco — rode `bun run db:migrate`",
  );
}

/**
 * Higieniza a lista antes de gravar.
 *
 * O que chega do cliente vira etapa de quadro depois, então uma polaridade
 * inventada aqui viraria um status que o app inteiro não sabe classificar —
 * nem concluído, nem em andamento, nem arquivado.
 */
export function sanitizeSeeds(input: unknown): StatusTemplateSeed[] {
  if (!Array.isArray(input)) return [];
  const seeds: StatusTemplateSeed[] = [];
  for (const raw of input.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item["name"] === "string" ? item["name"].trim().slice(0, 60) : "";
    if (!name) continue;
    const polarity = typeof item["polarity"] === "string" ? item["polarity"] : "";
    seeds.push({
      name,
      color: typeof item["color"] === "string" && item["color"] ? item["color"] : "#64748B",
      polarity: POLARITIES.has(polarity)
        ? (polarity as StatusTemplateSeed["polarity"])
        : "IN_PROGRESS",
    });
  }
  return seeds;
}

export async function listStatusTemplates(
  userId: string,
  accountId: string,
): Promise<StatusTemplate[]> {
  await requireAccountRole(userId, accountId, "viewer");
  try {
    return await query<StatusTemplate>(
      `SELECT id, account_id, name, statuses,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM status_templates WHERE account_id = $1 ORDER BY name`,
      [accountId],
    );
  } catch (error) {
    // Deploy com o código novo e a migração por rodar: o módulo segue de pé,
    // apenas sem modelos.
    if (!isMissingTable(error)) throw error;
    avisarBancoAntigo();
    return [];
  }
}

/** Cria ou renomeia um modelo. O nome é único na conta, e regravar o substitui. */
export async function saveStatusTemplate(
  userId: string,
  input: { id?: string | undefined; accountId: string; name: string; statuses: unknown },
): Promise<StatusTemplate> {
  await requireAccountRole(userId, input.accountId, "editor");

  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Dê um nome ao modelo");
  const seeds = sanitizeSeeds(input.statuses);
  if (seeds.length === 0) throw new Error("O modelo precisa de ao menos uma etapa");

  const row = await queryOne<StatusTemplate>(
    `INSERT INTO status_templates (id, account_id, name, statuses, created_by)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4::jsonb, $5)
     ON CONFLICT (account_id, name)
       DO UPDATE SET statuses = EXCLUDED.statuses, updated_at = now()
     RETURNING id, account_id, name, statuses,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
    [input.id ?? null, input.accountId, name, JSON.stringify(seeds), userId],
  );
  if (!row) throw new Error("Não foi possível salvar o modelo");
  return row;
}

export async function deleteStatusTemplate(userId: string, id: string): Promise<void> {
  const row = await queryOne<{ account_id: string }>(
    `SELECT account_id FROM status_templates WHERE id = $1`,
    [id],
  );
  if (!row) return;
  await requireAccountRole(userId, row.account_id, "editor");
  await query(`DELETE FROM status_templates WHERE id = $1`, [id]);
}
