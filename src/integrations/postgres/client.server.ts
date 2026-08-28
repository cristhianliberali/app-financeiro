/**
 * Pool de conexões com o Postgres.
 *
 * Só pode ser importado de dentro de código que roda no servidor — em módulos
 * `*.server.ts` no topo do arquivo, ou via `await import()` dentro do
 * `.handler()` de uma server function. `pg` depende de módulos `node:*` e
 * quebra o build se vazar para o bundle do navegador.
 */
import pg from "pg";

import { getPostgresSettings } from "./config.server";

const { Pool, types } = pg;

// NUMERIC chega como string por padrão (para não perder precisão em valores
// gigantes). Os valores aqui são financeiros em NUMERIC(14,2), que cabem com
// folga em um double — converter no driver evita `Number(...)` em cada query.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));
// DATE volta como string "YYYY-MM-DD" em vez de Date, que o driver
// interpretaria no fuso do servidor e poderia deslocar o dia.
types.setTypeParser(types.builtins.DATE, (value) => value);
// BIGINT/INT8: os contadores do app cabem em Number com segurança.
types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const settings = getPostgresSettings();
  pool = new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    // POSTGRES_SSL=false cobre o caso comum de banco em rede privada sem
    // certificado. Com `true` aceitamos certificado autoassinado, que é o
    // padrão de quem sobe o Postgres em container.
    ssl: settings.ssl ? { rejectUnauthorized: false } : false,
    max: settings.poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Definido como parâmetro de conexão (e não com `SET` no evento `connect`,
    // que o pool não espera terminar) para que toda conexão já nasça apontando
    // para o schema certo.
    options: `-c search_path=${settings.schema},public`,
  });

  pool.on("error", (error) => {
    // Conexão ociosa derrubada pelo banco/proxy: o pool descarta o cliente
    // sozinho, mas sem este listener o Node encerraria o processo.
    console.error("[postgres] erro em conexão ociosa:", error);
  });

  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as never[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Roda o callback dentro de uma transação, com rollback em caso de erro. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Ping usado pelo health check. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (error) {
    console.error("[postgres] health check falhou:", error);
    return false;
  }
}
