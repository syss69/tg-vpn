import { readFileSync } from "fs";
import { join } from "path";
import { getPool } from "./pool";

/**
 * Verifies PostgreSQL connectivity at startup.
 */
function isInsufficientPrivilege(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "42501"
  );
}

export async function initDatabase(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    try {
      await client.query("SELECT 1");
    } catch (e) {
      if (isInsufficientPrivilege(e)) {
        throw new Error(
          "PostgreSQL: нет доступа к схеме (часто public). Варианты: выполнить от суперпользователя " +
            "`GRANT USAGE ON SCHEMA public TO текущий_роль;` либо задать в .env свою схему, например " +
            "`PG_SEARCH_PATH=имя_вашей_схемы` (см. .env.example)."
        );
      }
      throw e;
    }

    // Optional DDL: sql/schema_bootstrap.sql (users, subscription_*, crypto_pay_invoices).
    if (process.env.DB_AUTO_MIGRATE === "true") {
      try {
        const bootstrapSql = readFileSync(join(process.cwd(), "sql", "schema_bootstrap.sql"), "utf8");
        await client.query(bootstrapSql);
      } catch (e) {
        if (isInsufficientPrivilege(e)) {
          console.warn(
            "[db] DB_AUTO_MIGRATE: нет прав на CREATE в текущей схеме (42501). " +
              "Отключите DB_AUTO_MIGRATE и примените sql/*.sql вручную от администратора БД, либо выдайте права на схему."
          );
        } else {
          throw e;
        }
      }
    }
  } finally {
    client.release();
  }
}
