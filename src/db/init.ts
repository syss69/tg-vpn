import { getPool } from "./pool";

/**
 * Verifies PostgreSQL connectivity at startup.
 */
export async function initDatabase(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("SELECT 1");
    // Optional DDL: some managed Postgres users may not have CREATE privileges in `public`.
    // Payments logic can still work with in-memory fallback (see CryptoPayInvoiceStore).
    if (process.env.DB_AUTO_MIGRATE === "true") {
      await client.query(
        `CREATE TABLE IF NOT EXISTS crypto_pay_invoices (
          invoice_id BIGINT PRIMARY KEY,
          tg_id BIGINT NOT NULL,
          amount_units INTEGER NOT NULL,
          asset TEXT NOT NULL,
          amount_asset TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          credited BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_crypto_pay_invoices_tg_id ON crypto_pay_invoices (tg_id)`
      );
    }
  } finally {
    client.release();
  }
}
