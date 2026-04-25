import { Pool } from "pg";
import { getPool } from "../db/pool";

export type StoredInvoiceStatus = "active" | "paid" | "expired" | "unknown";

export interface StoredInvoiceRow {
  invoice_id: number;
  tg_id: number;
  amount_units: number;
  asset: string;
  amount_asset: string;
  status: StoredInvoiceStatus;
  credited: boolean;
  created_at: string;
  updated_at: string;
}

export class CryptoPayInvoiceStore {
  private memory = new Map<
    number,
    {
      tgId: number;
      amountUnits: number;
      asset: string;
      amountAsset: string;
      status: StoredInvoiceStatus;
      credited: boolean;
    }
  >();

  private get pool(): Pool {
    return getPool();
  }

  private shouldFallbackToMemory(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    // Typical Postgres errors:
    // - permission denied for schema public
    // - relation "crypto_pay_invoices" does not exist
    return (
      msg.toLowerCase().includes("permission denied for schema") ||
      msg.toLowerCase().includes("нет доступа к схеме") ||
      msg.toLowerCase().includes("does not exist") ||
      msg.toLowerCase().includes("не существует") ||
      msg.toLowerCase().includes("crypto_pay_invoices")
    );
  }

  async ensureInvoice(params: {
    invoiceId: number;
    tgId: number;
    amountUnits: number;
    asset: string;
    amountAsset: string;
    status: StoredInvoiceStatus;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO crypto_pay_invoices (invoice_id, tg_id, amount_units, asset, amount_asset, status, credited)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         ON CONFLICT (invoice_id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [
          params.invoiceId,
          params.tgId,
          params.amountUnits,
          params.asset,
          params.amountAsset,
          params.status,
        ]
      );
    } catch (e) {
      if (!this.shouldFallbackToMemory(e)) throw e;
      this.memory.set(params.invoiceId, {
        tgId: params.tgId,
        amountUnits: params.amountUnits,
        asset: params.asset,
        amountAsset: params.amountAsset,
        status: params.status,
        credited: false,
      });
    }
  }

  async markStatus(params: { invoiceId: number; status: StoredInvoiceStatus }): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE crypto_pay_invoices SET status = $2, updated_at = NOW() WHERE invoice_id = $1`,
        [params.invoiceId, params.status]
      );
    } catch (e) {
      if (!this.shouldFallbackToMemory(e)) throw e;
      const row = this.memory.get(params.invoiceId);
      if (row) row.status = params.status;
    }
  }

  async tryCreditInvoice(params: { invoiceId: number; tgId: number }): Promise<
    | { ok: true; alreadyCredited: true; amountUnits: number; bonusUnits?: number }
    | { ok: true; alreadyCredited: false; amountUnits: number; bonusUnits?: number }
    | { ok: false; error: string }
  > {
    try {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query<{
          tg_id: number;
          amount_units: number;
          credited: boolean;
          status: StoredInvoiceStatus;
        }>(
          `SELECT tg_id, amount_units, credited, status
           FROM crypto_pay_invoices
           WHERE invoice_id = $1
           FOR UPDATE`,
          [params.invoiceId]
        );

        const row = res.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return { ok: false, error: "Инвойс не найден в базе бота." };
        }
        if (row.tg_id !== params.tgId) {
          await client.query("ROLLBACK");
          return { ok: false, error: "Этот инвойс принадлежит другому пользователю." };
        }
        if (row.status !== "paid") {
          await client.query("ROLLBACK");
          return { ok: false, error: "Инвойс ещё не оплачен." };
        }
        if (row.credited) {
          await client.query("COMMIT");
          return { ok: true, alreadyCredited: true, amountUnits: row.amount_units };
        }

        await client.query(
          `UPDATE users SET balance = balance + $2, updated_at = NOW()
           WHERE tg_id = $1`,
          [params.tgId, row.amount_units]
        );

        // Бонус к пополнению (topup_bonus_pct): один ожидающий промокод → применяем к этому зачислению.
        // Если таблиц нет / нет прав, это поймается общим catch и fallback-логикой.
        let bonusUnits = 0;
        const userIdRes = await client.query<{ id: number }>(`SELECT id FROM users WHERE tg_id = $1`, [params.tgId]);
        const dbUserId = userIdRes.rows[0]?.id;
        if (dbUserId !== undefined) {
          const promoRes = await client.query<{ redemption_id: number; pct: number }>(
            `SELECT r.id AS redemption_id, c.topup_bonus_pct AS pct
             FROM promo_redemptions r
             JOIN promo_codes c ON c.code = r.code
             WHERE r.user_id = $1
               AND r.applied_at IS NULL
               AND c.kind = 'topup_bonus_pct'
               AND (c.expires_at IS NULL OR c.expires_at > NOW())
             ORDER BY r.redeemed_at DESC
             LIMIT 1
             FOR UPDATE`,
            [dbUserId]
          );
          const promo = promoRes.rows[0];
          const pct = promo?.pct ?? 0;
          if (promo?.redemption_id && pct > 0 && pct <= 100) {
            bonusUnits = Math.floor((row.amount_units * pct) / 100);
            if (bonusUnits > 0) {
              await client.query(
                `UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE tg_id = $1`,
                [params.tgId, bonusUnits]
              );
            }
            await client.query(`UPDATE promo_redemptions SET applied_at = NOW() WHERE id = $1`, [
              promo.redemption_id,
            ]);
          }
        }

        await client.query(
          `UPDATE crypto_pay_invoices SET credited = true, updated_at = NOW() WHERE invoice_id = $1`,
          [params.invoiceId]
        );
        await client.query("COMMIT");
        return {
          ok: true,
          alreadyCredited: false,
          amountUnits: row.amount_units,
          ...(bonusUnits > 0 ? { bonusUnits } : {}),
        };
      } catch (e) {
        await client.query("ROLLBACK");
        if (this.shouldFallbackToMemory(e)) {
          // fall through to memory mode below
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      } finally {
        client.release();
      }
    } catch (e) {
      if (!this.shouldFallbackToMemory(e)) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    }

    // In-memory fallback (no DB table / no DDL rights).
    const row = this.memory.get(params.invoiceId);
    if (!row) return { ok: false, error: "Инвойс не найден (fallback-режим без БД)." };
    if (row.tgId !== params.tgId) return { ok: false, error: "Этот инвойс принадлежит другому пользователю." };
    if (row.status !== "paid") return { ok: false, error: "Инвойс ещё не оплачен." };
    if (row.credited) return { ok: true, alreadyCredited: true, amountUnits: row.amountUnits };

    const updated = await this.pool
      .query(
        `UPDATE users SET balance = balance + $2, updated_at = NOW()
         WHERE tg_id = $1`,
        [params.tgId, row.amountUnits]
      )
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(msg);
      });
    if ((updated.rowCount ?? 0) <= 0) return { ok: false, error: "Не удалось зачислить баланс." };
    row.credited = true;
    return { ok: true, alreadyCredited: false, amountUnits: row.amountUnits };
  }
}

