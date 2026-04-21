import { Pool } from "pg";
import { getPool } from "../db/pool";
import { PanelApiService } from "./PanelApiService";
import { UserService } from "./UserService";

type PromoCodeKind = "trial_days" | "balance_bonus" | "topup_bonus_pct";

interface DbClient {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>;
}

interface PromoCodeRow {
  code: string;
  kind: PromoCodeKind;
  subscription_type_code?: string | null;
  trial_days: number | null;
  balance_bonus: number | null;
  topup_bonus_pct?: number | null;
  max_redemptions: number | null;
  expires_at: Date | null;
}

interface PromoRedemptionRow {
  id: number;
}

export type RedeemPromoResult =
  | { ok: true; message: string }
  | {
      ok: false;
      reason:
        | "empty"
        | "not_found"
        | "expired"
        | "already_used"
        | "limit_reached"
        | "bad_config"
        | "db_missing"
        | "user_missing"
        | "unknown";
      message: string;
    };

export class PromoService {
  private readonly userService = new UserService();
  private readonly panelApi = new PanelApiService();

  private get pool(): Pool {
    return getPool();
  }

  private normalizeCode(code: string): string {
    return code.trim().replace(/\s+/g, "").toUpperCase();
  }

  private endsAtDaysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  private async getDbUserIdByTgId(client: DbClient, tgId: number) {
    const r = await client.query<{ id: number }>(`SELECT id FROM users WHERE tg_id = $1`, [tgId]);
    return r.rows[0]?.id ?? null;
  }

  private async insertPendingPromoSubscription(params: {
    tgId: number;
    durationDays: number;
    subscriptionTypeCode: string;
  }): Promise<{ ok: true; subscriptionRowId: number } | { ok: false; error: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const dbUserId = await this.getDbUserIdByTgId(client, params.tgId);
      if (dbUserId === null) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Пользователь не найден в базе." };
      }

      const t = await client.query<{ id: number }>(
        `SELECT id FROM subscription_types WHERE code = $1`,
        [params.subscriptionTypeCode]
      );
      const typeId = t.rows[0]?.id;
      if (typeId === undefined) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error:
            "В базе нет типа подписки для промо. Выполните миграцию (DB_AUTO_MIGRATE=true или примените sql/schema_bootstrap.sql).",
        };
      }

      const endsAt = this.endsAtDaysFromNow(params.durationDays);
      const ins = await client.query<{ id: number }>(
        `INSERT INTO subscriptions (
          user_id, subscription_type_id, price_paid, traffic, device_limit,
          starts_at, ends_at, status
        ) VALUES ($1, $2, 0, NULL, NULL, NOW(), $3, 'pending_payment')
        RETURNING id`,
        [dbUserId, typeId, endsAt]
      );
      const subscriptionRowId = ins.rows[0]?.id;
      if (!subscriptionRowId) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Не удалось создать промо-подписку в БД." };
      }

      await client.query("COMMIT");
      return { ok: true, subscriptionRowId };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Бесплатная промо-подписка на 3 дня — только один раз для нового пользователя.
   */
  async grantNewUserTrial(params: {
    tgId: number;
    telegramUsername?: string;
  }): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<{ trial_granted_at: Date | null }>(
        `SELECT trial_granted_at FROM users WHERE tg_id = $1 FOR UPDATE`,
        [params.tgId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { ok: false, message: "Пользователь не найден в базе." };
      }
      if (row.trial_granted_at) {
        await client.query("ROLLBACK");
        return { ok: false, message: "Промо-подписка уже была выдана ранее." };
      }

      await client.query(
        `UPDATE users SET trial_granted_at = NOW(), updated_at = NOW() WHERE tg_id = $1`,
        [params.tgId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    const pending = await this.insertPendingPromoSubscription({
      tgId: params.tgId,
      durationDays: 3,
      subscriptionTypeCode: "promo_trial",
    });
    if (!pending.ok) {
      await this.pool.query(
        `UPDATE users SET trial_granted_at = NULL, updated_at = NOW() WHERE tg_id = $1`,
        [params.tgId]
      );
      return { ok: false, message: pending.error };
    }

    const panel = await this.panelApi.createClientForSubscriptionPeriod(params.tgId, 3, {
      planId: "promo_trial",
      telegramUsername: params.telegramUsername,
      subscriptionRowId: pending.subscriptionRowId,
    });
    if (!panel.ok) {
      await this.userService.cancelPendingSubscription(pending.subscriptionRowId, params.tgId);
      await this.pool.query(
        `UPDATE users SET trial_granted_at = NULL, updated_at = NOW() WHERE tg_id = $1`,
        [params.tgId]
      );
      return { ok: false, message: panel.error };
    }

    const sub = await this.userService.finalizeSubscription(pending.subscriptionRowId, params.tgId, panel);
    if (!sub) {
      await this.userService.cancelPendingSubscription(pending.subscriptionRowId, params.tgId);
      await this.pool.query(
        `UPDATE users SET trial_granted_at = NULL, updated_at = NOW() WHERE tg_id = $1`,
        [params.tgId]
      );
      return { ok: false, message: "Не удалось зафиксировать промо-подписку в БД." };
    }

    return {
      ok: true,
      message:
        `🎁 <b>Подарок для новых пользователей!</b>\n` +
        `Активирована бесплатная промо-подписка на <b>3 дня</b>.\n` +
        `📅 До: <b>${new Date(sub.expiresAt).toLocaleDateString("ru-RU")}</b>`,
    };
  }

  async redeemPromoCode(params: {
    tgId: number;
    rawCode: string;
    telegramUsername?: string;
  }): Promise<RedeemPromoResult> {
    const code = this.normalizeCode(params.rawCode);
    if (!code) {
      return {
        ok: false,
        reason: "empty",
        message: "Укажите промокод. Пример: <code>/promo ABC123</code>",
      };
    }

    // Балансный бонус можно применять полностью внутри транзакции.
    // Триал-подписка требует вызова панели → делаем компенсацию при ошибке.
    const tx = await this.pool.connect();
    let redemptionId: number | null = null;
    let pendingSubscriptionRowId: number | null = null;
    let promo: PromoCodeRow | null = null;
    try {
      await tx.query("BEGIN");
      const p = await tx.query<PromoCodeRow>(
        `SELECT code, kind, subscription_type_code, trial_days, balance_bonus, topup_bonus_pct, max_redemptions, expires_at
         FROM promo_codes
         WHERE code = $1
         FOR UPDATE`,
        [code]
      );
      promo = p.rows[0] ?? null;
      if (!promo) {
        await tx.query("ROLLBACK");
        return { ok: false, reason: "not_found", message: "Промокод не найден." };
      }
      if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) {
        await tx.query("ROLLBACK");
        return { ok: false, reason: "expired", message: "Срок действия промокода истёк." };
      }

      const dbUserId = await this.getDbUserIdByTgId(tx, params.tgId);
      if (dbUserId === null) {
        await tx.query("ROLLBACK");
        return { ok: false, reason: "user_missing", message: "Пользователь не найден в базе." };
      }

      const ins = await tx.query<PromoRedemptionRow>(
        `INSERT INTO promo_redemptions (code, user_id)
         VALUES ($1, $2)
         ON CONFLICT (code, user_id) DO NOTHING
         RETURNING id`,
        [code, dbUserId]
      );
      redemptionId = ins.rows[0]?.id ?? null;
      if (redemptionId === null) {
        await tx.query("ROLLBACK");
        return {
          ok: false,
          reason: "already_used",
          message: "Этот промокод уже был активирован на вашем аккаунте.",
        };
      }

      if (promo.max_redemptions != null) {
        const c = await tx.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM promo_redemptions WHERE code = $1`,
          [code]
        );
        const n = parseInt(c.rows[0]?.n ?? "0", 10);
        if (n > promo.max_redemptions) {
          await tx.query("ROLLBACK");
          return { ok: false, reason: "limit_reached", message: "Лимит активаций промокода исчерпан." };
        }
      }

      if (promo.kind === "balance_bonus") {
        const bonus = promo.balance_bonus ?? 0;
        if (bonus <= 0) {
          await tx.query("ROLLBACK");
          return {
            ok: false,
            reason: "bad_config",
            message: "Промокод настроен некорректно (balance_bonus).",
          };
        }
        await tx.query(
          `UPDATE users SET balance = balance + $2, updated_at = NOW() WHERE tg_id = $1`,
          [params.tgId, bonus]
        );
        await tx.query(
          `UPDATE promo_redemptions SET applied_at = NOW() WHERE id = $1`,
          [redemptionId]
        );
        await tx.query("COMMIT");
        return { ok: true, message: `✅ Промокод активирован. Баланс пополнен на <b>${bonus}</b>.` };
      }

      if (promo.kind === "topup_bonus_pct") {
        const pct = promo.topup_bonus_pct ?? 0;
        if (pct <= 0 || pct > 100) {
          await tx.query("ROLLBACK");
          return { ok: false, reason: "bad_config", message: "Промокод настроен некорректно (topup_bonus_pct)." };
        }

        // Не даём копить несколько "ожидающих" процентных промо.
        const pend = await tx.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM promo_redemptions r
           JOIN promo_codes c ON c.code = r.code
           WHERE r.user_id = $1 AND r.applied_at IS NULL AND c.kind = 'topup_bonus_pct'`,
          [dbUserId]
        );
        const pendingCount = parseInt(pend.rows[0]?.n ?? "0", 10);
        if (pendingCount > 0) {
          await tx.query("ROLLBACK");
          return {
            ok: false,
            reason: "already_used",
            message: "У вас уже есть активированный промокод на бонус к пополнению. Сначала выполните пополнение.",
          };
        }

        await tx.query("COMMIT");
        return {
          ok: true,
          message:
            `✅ Промокод активирован.\n` +
            `🎁 Бонус к следующему пополнению: <b>+${pct}%</b>\n` +
            `Пополните баланс — бонус начислится автоматически.`,
        };
      }

      if (promo.kind === "trial_days") {
        const days = promo.trial_days ?? 0;
        if (days <= 0) {
          await tx.query("ROLLBACK");
          return {
            ok: false,
            reason: "bad_config",
            message: "Промокод настроен некорректно (trial_days).",
          };
        }

        const subscriptionTypeCode =
          promo.subscription_type_code?.trim() && promo.subscription_type_code.trim().length > 0
            ? promo.subscription_type_code.trim()
            : "promo_trial";

        const t = await tx.query<{ id: number }>(
          `SELECT id FROM subscription_types WHERE code = $1`,
          [subscriptionTypeCode]
        );
        const typeId = t.rows[0]?.id;
        if (typeId === undefined) {
          await tx.query("ROLLBACK");
          return {
            ok: false,
            reason: "db_missing",
            message:
              "В базе нет указанного типа подписки для промокода. Выполните миграцию или проверьте subscription_types.code.",
          };
        }

        const endsAt = this.endsAtDaysFromNow(days);
        const s = await tx.query<{ id: number }>(
          `INSERT INTO subscriptions (
            user_id, subscription_type_id, price_paid, traffic, device_limit,
            starts_at, ends_at, status
          ) VALUES ($1, $2, 0, NULL, NULL, NOW(), $3, 'pending_payment')
          RETURNING id`,
          [dbUserId, typeId, endsAt]
        );
        pendingSubscriptionRowId = s.rows[0]?.id ?? null;
        if (pendingSubscriptionRowId === null) {
          await tx.query("ROLLBACK");
          return { ok: false, reason: "unknown", message: "Не удалось создать промо-подписку в БД." };
        }

        await tx.query("COMMIT");

        const panel = await this.panelApi.createClientForSubscriptionPeriod(params.tgId, days, {
          planId: subscriptionTypeCode,
          telegramUsername: params.telegramUsername,
          subscriptionRowId: pendingSubscriptionRowId,
        });
        if (!panel.ok) {
          await this.userService.cancelPendingSubscription(pendingSubscriptionRowId, params.tgId);
          await this.pool.query(`DELETE FROM promo_redemptions WHERE id = $1`, [redemptionId]);
          return { ok: false, reason: "unknown", message: panel.error };
        }

        const sub = await this.userService.finalizeSubscription(pendingSubscriptionRowId, params.tgId, panel);
        if (!sub) {
          await this.userService.cancelPendingSubscription(pendingSubscriptionRowId, params.tgId);
          await this.pool.query(`DELETE FROM promo_redemptions WHERE id = $1`, [redemptionId]);
          return {
            ok: false,
            reason: "unknown",
            message: "Панель ответила успешно, но не удалось зафиксировать подписку в БД.",
          };
        }

        await this.pool.query(`UPDATE promo_redemptions SET applied_at = NOW() WHERE id = $1`, [redemptionId]);
        return {
          ok: true,
          message:
            `✅ Промокод активирован. Выдана промо-подписка на <b>${days} дн.</b>\n` +
            `📅 До: <b>${new Date(sub.expiresAt).toLocaleDateString("ru-RU")}</b>`,
        };
      }

      await tx.query("ROLLBACK");
      return { ok: false, reason: "unknown", message: "Неизвестный тип промокода." };
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  }
}

