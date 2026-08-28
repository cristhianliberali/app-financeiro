/**
 * Aplica o `db/schema.sql` usando a mesma conexão do app.
 *
 *   bun run db:migrate
 *
 * Alternativa ao psql e ao console SQL do painel: lê as variáveis POSTGRES_*,
 * abre uma conexão e manda o arquivo inteiro de uma vez. Sem parâmetros na
 * query, o driver usa o protocolo simples do Postgres, que aceita vários
 * comandos numa chamada só e roda todos dentro de uma transação implícita —
 * ou o schema inteiro é aplicado, ou nada é.
 *
 * O script é idempotente: rodar de novo em um banco já populado não apaga dados.
 */
import { readFileSync } from "node:fs";

import { getPostgresSettings } from "../src/integrations/postgres/config.server";
import { getPool } from "../src/integrations/postgres/client.server";

const SCHEMA_FILE = new URL("../db/schema.sql", import.meta.url);

async function main() {
  const settings = getPostgresSettings();
  const sql = readFileSync(SCHEMA_FILE, "utf8");

  console.log(
    `Aplicando db/schema.sql em ${settings.host}:${settings.port}/${settings.database} ` +
      `(schema=${settings.schema})`,
  );

  const client = await getPool().connect();
  try {
    // Avisos do Postgres (extensão sem permissão, trigger inexistente no
    // primeiro run) são esperados e não indicam falha — mas vale mostrá-los.
    client.on("notice", (notice) => console.log(`  aviso: ${notice.message}`));
    await client.query(sql);
  } finally {
    client.release();
  }

  const { rows } = await getPool().query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [settings.schema],
  );

  console.log(`\n${rows.length} tabelas em "${settings.schema}":`);
  for (const row of rows) console.log(`  ${row.tablename}`);
  console.log("\nPronto. Confira com: bun run db:check");
}

main()
  .catch((error) => {
    console.error("\nFalhou:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
