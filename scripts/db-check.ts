/**
 * Confere a conexão com o Postgres e se o schema já foi aplicado.
 *
 *   bun run db:check
 *
 * Lê as mesmas variáveis que o app (POSTGRES_*), então é a forma mais rápida de
 * validar credenciais novas antes de subir o serviço.
 */
import { getPostgresSettings } from "../src/integrations/postgres/config.server";
import { getPool, query } from "../src/integrations/postgres/client.server";

const EXPECTED_TABLES = [
  "app_users",
  "user_sessions",
  "accounts",
  "account_members",
  "account_invites",
  "budget_profiles",
  "categories",
  "transactions",
  "recurring_rules",
  "investments",
  "goals",
  "spaces",
  "space_members",
  "boards",
  "board_members",
  "board_statuses",
  "tasks",
  "task_participants",
  "subtasks",
  "time_entries",
  "task_activity",
  "labels",
  "task_label_links",
  "task_reminders",
];

async function main() {
  const settings = getPostgresSettings();
  console.log(
    `Conectando em ${settings.host}:${settings.port}/${settings.database} ` +
      `como ${settings.user} (ssl=${settings.ssl}, schema=${settings.schema})`,
  );

  const [{ version }] = await query<{ version: string }>("SELECT version()");
  console.log(`Conectado: ${version.split(",")[0]}`);

  const present = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [settings.schema],
  );
  const names = new Set(present.map((row) => row.tablename));
  const missing = EXPECTED_TABLES.filter((table) => !names.has(table));

  for (const table of EXPECTED_TABLES) {
    console.log(`  ${names.has(table) ? "✓" : "✗"} ${table}`);
  }

  if (missing.length) {
    console.error(
      `\nFaltam ${missing.length} tabela(s). Aplique o schema com:\n  bun run db:migrate`,
    );
    process.exitCode = 1;
    return;
  }

  const [{ total }] = await query<{ total: number }>(
    "SELECT count(*)::bigint AS total FROM app_users",
  );
  console.log(`\nSchema completo. Usuários cadastrados: ${total}`);
}

main()
  .catch((error) => {
    console.error("\nFalhou:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
