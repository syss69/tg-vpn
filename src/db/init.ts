import { getPool } from "./pool";

/**
 * Verifies PostgreSQL connectivity at startup.
 */
export async function initDatabase(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
