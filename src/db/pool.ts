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
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
