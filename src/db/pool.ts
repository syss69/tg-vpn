import { Pool, types } from "pg";

/** Parse int8 (bigint) as number — safe for Telegram user ids in practice. */
types.setTypeParser(types.builtins.INT8, (val: string) => parseInt(val, 10));

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Add it to .env (PostgreSQL connection string)."
      );
    }
    /**
     * Если у роли нет USAGE на public, провайдер часто даёт отдельную схему (имя = пользователь).
     * Пример: PG_SEARCH_PATH=myuser или myuser,public
     */
    const searchPath = process.env.PG_SEARCH_PATH?.trim();
    pool = new Pool({
      connectionString,
      ...(searchPath ? { options: `-csearch_path=${searchPath}` } : {}),
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
