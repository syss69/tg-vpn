import { existsSync, readFileSync } from "fs";
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

function pgErrorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function warnMigrateDenied(filePath: string, err: unknown): void {
  console.warn(`[db] Ошибка применения ${filePath}: ${pgErrorDetail(err)}`);
  console.warn(
    "[db] Если это 42501: нужны права на CREATE в схеме (часто `GRANT CREATE ON SCHEMA public TO …` от владельца БД). " +
      "На managed-хостингах проверьте, что роль в DATABASE_URL совпадает с той, которой выдали GRANT. " +
      "Либо DB_AUTO_MIGRATE=false и выполните sql/*.sql вручную."
  );
}

async function runSqlFile(
  client: { query: (text: string) => Promise<unknown> },
  filePath: string,
  okLog: string
): Promise<boolean> {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    await client.query(readFileSync(filePath, "utf8"));
    console.log(`[db] ${okLog}`);
    return true;
  } catch (e) {
    if (isInsufficientPrivilege(e)) {
      warnMigrateDenied(filePath, e);
      return false;
    }
    throw e;
  }
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

    if (process.env.DB_AUTO_MIGRATE === "true") {
      const sqlDir = join(process.cwd(), "sql");
      await runSqlFile(
        client,
        join(sqlDir, "schema_bootstrap.sql"),
        "Применён sql/schema_bootstrap.sql"
      );
      await runSqlFile(
        client,
        join(sqlDir, "migration_happ_proxy.sql"),
        "Применена sql/migration_happ_proxy.sql (обновление со старой колонки key / индексы)"
      );
    }
  } finally {
    client.release();
  }
}
