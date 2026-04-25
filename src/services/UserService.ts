import { Pool } from "pg";
import { getPool } from "../db/pool";
import { Subscription, User } from "../types";
import { gbToBytes } from "./RemnawaveClient";

interface UserRow {
  tg_id: number;
  username: string | null;
  first_name?: string | null;
  language_code?: string | null;
  balance: number;
  purchased_keys: unknown;
  traffic_wallet_gb: number | null;
  created_at: Date;
}

interface SubscriptionDbRow {
  id: number;
  plan_id: string;
  plan_title: string;
  key: string | null;
  traffic: string | null;
  starts_at: Date;
  ends_at: Date;
  panel_client_id: string | null;
}

function mapDbRowToSubscription(row: SubscriptionDbRow, panelEmail: string): Subscription {
  const trafficBytes = row.traffic != null && row.traffic !== "" ? Number(row.traffic) : 0;
  const totalTrafficGb = trafficBytes > 0 ? trafficBytes / (1024 * 1024 * 1024) : 0;
  return {
    id: String(row.id),
    planId: row.plan_id,
    planTitle: row.plan_title,
    panelClientUuid: row.panel_client_id ?? "",
    panelEmail,
    subscriptionUrl: row.key ?? "",
    expiresAt: row.ends_at.toISOString(),
    purchasedAt: row.starts_at.toISOString(),
    totalTrafficGb,
    usedTrafficGb: 0,
  };
}

function rowToUser(row: UserRow, subscriptionsFromDb: Subscription[] | undefined): User {
  const raw = row.purchased_keys;
  const legacy = (Array.isArray(raw) ? raw : []) as Subscription[];
  const subscriptions =
    subscriptionsFromDb !== undefined && subscriptionsFromDb.length > 0 ? subscriptionsFromDb : legacy;
  return {
    id: row.tg_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    languageCode: row.language_code ?? undefined,
    balance: row.balance,
    subscriptions,
    trafficWalletGb: row.traffic_wallet_gb ?? 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Сервис пользователей: PostgreSQL (users; подписки — таблица subscriptions или legacy JSONB purchased_keys).
 */
export class UserService {
  private get pool(): Pool {
    return getPool();
  }

  /** Внутренний id строки users.id по Telegram id (subscriptions.user_id ссылается на него). */
  private async getDbUserIdByTgId(tgId: number): Promise<number | null> {
    const r = await this.pool.query<{ id: number }>(`SELECT id FROM users WHERE tg_id = $1`, [tgId]);
    return r.rows[0]?.id ?? null;
  }

  private async loadSubscriptionsFromDatabase(tgId: number): Promise<Subscription[]> {
    const res = await this.pool.query<SubscriptionDbRow>(
      `SELECT s.id, t.code AS plan_id, t.name AS plan_title, s.key, s.traffic::text AS traffic,
              s.starts_at, s.ends_at, s.panel_client_id
       FROM subscriptions s
       JOIN subscription_types t ON t.id = s.subscription_type_id
       JOIN users u ON u.id = s.user_id
       WHERE u.tg_id = $1
         AND s.status NOT IN ('cancelled', 'pending_payment')
       ORDER BY s.id`,
      [tgId]
    );
    return res.rows.map((row) => mapDbRowToSubscription(row, ""));
  }

  async findById(userId: number): Promise<User | undefined> {
    const res = await this.pool.query<UserRow>(
      `SELECT tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at
       FROM users WHERE tg_id = $1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return rowToUser(row, await this.tryLoadSubscriptionsFromDatabase(userId));
  }

  /** Таблица subscriptions может отсутствовать до миграции — тогда только legacy JSON. */
  private async tryLoadSubscriptionsFromDatabase(userId: number): Promise<Subscription[] | undefined> {
    try {
      const subs = await this.loadSubscriptionsFromDatabase(userId);
      return subs.length > 0 ? subs : undefined;
    } catch {
      return undefined;
    }
  }

  private async insertUser(
    userId: number,
    username?: string
  ): Promise<User> {
    const res = await this.pool.query<UserRow>(
      `INSERT INTO users (tg_id, username)
       VALUES ($1, $2)
       RETURNING tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at`,
      [userId, username ?? null]
    );
    return rowToUser(res.rows[0], undefined);
  }

  async createUser(userId: number, username?: string): Promise<User> {
    return this.insertUser(userId, username);
  }

  async getOrCreate(userId: number, username?: string): Promise<User> {
    const res = await this.pool.query<UserRow>(
      `INSERT INTO users (tg_id, username)
       VALUES ($1, $2)
       ON CONFLICT (tg_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, users.username),
         updated_at = NOW()
       RETURNING tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at`,
      [userId, username ?? null]
    );
    return rowToUser(res.rows[0], await this.tryLoadSubscriptionsFromDatabase(userId));
  }

  /**
   * Первый /start: сохраняет пользователя в БД, если записи ещё нет (без обновления существующих).
   */
  async ensureUserOnBotStart(params: {
    tgId: number;
    username?: string;
    firstName?: string;
    languageCode?: string;
  }): Promise<{ isNew: boolean }> {
    const r = await this.pool.query<{ id: number }>(
      `INSERT INTO users (tg_id, username, first_name, language_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tg_id) DO NOTHING
       RETURNING id`,
      [
        params.tgId,
        params.username ?? null,
        params.firstName ?? null,
        params.languageCode ?? null,
      ]
    );
    return { isNew: r.rows.length > 0 };
  }

  async topUpBalance(userId: number, amount: number): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      `UPDATE users SET balance = balance + $2, updated_at = NOW()
       WHERE tg_id = $1
       RETURNING tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at`,
      [userId, amount]
    );
    const row = res.rows[0];
    if (!row) return null;
    return rowToUser(row, await this.tryLoadSubscriptionsFromDatabase(userId));
  }

  async deductBalance(userId: number, amount: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE users SET balance = balance - $2, updated_at = NOW()
       WHERE tg_id = $1 AND balance >= $2`,
      [userId, amount]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Строка в subscriptions со статусом pending_payment до успешного создания пользователя в панели.
   */
  async createPendingSubscription(
    tgUserId: number,
    planId: string,
    params: {
      pricePaid: number;
      trafficLimitBytes: number | null;
      deviceLimit: number | null;
      endsAt: Date;
    }
  ): Promise<number | null> {
    try {
      const dbUserId = await this.getDbUserIdByTgId(tgUserId);
      if (dbUserId === null) {
        return null;
      }

      const t = await this.pool.query<{ id: number }>(
        `SELECT id FROM subscription_types WHERE code = $1`,
        [planId]
      );
      const typeId = t.rows[0]?.id;
      if (typeId === undefined) {
        return null;
      }

      const traffic =
        params.trafficLimitBytes != null && params.trafficLimitBytes > 0
          ? params.trafficLimitBytes
          : null;

      const ins = await this.pool.query<{ id: number }>(
        `INSERT INTO subscriptions (
          user_id, subscription_type_id, price_paid, traffic, device_limit,
          starts_at, ends_at, status
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'pending_payment')
        RETURNING id`,
        [dbUserId, typeId, params.pricePaid, traffic, params.deviceLimit, params.endsAt]
      );
      return ins.rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  async cancelPendingSubscription(subscriptionRowId: number, tgUserId: number): Promise<void> {
    const dbUserId = await this.getDbUserIdByTgId(tgUserId);
    if (dbUserId === null) {
      return;
    }
    await this.pool.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_payment'`,
      [subscriptionRowId, dbUserId]
    );
  }

  async finalizeSubscription(
    subscriptionRowId: number,
    tgUserId: number,
    panel: { clientId: string; subscriptionUrl: string; email: string }
  ): Promise<Subscription | null> {
    const dbUserId = await this.getDbUserIdByTgId(tgUserId);
    if (dbUserId === null) {
      return null;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE subscriptions SET
          status = 'active',
          panel_client_id = $2,
          key = $3,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $4 AND status = 'pending_payment'
        RETURNING id`,
        [subscriptionRowId, panel.clientId, panel.subscriptionUrl, dbUserId]
      );
      if ((upd.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const r = await client.query<SubscriptionDbRow>(
        `SELECT s.id, t.code AS plan_id, t.name AS plan_title, s.key, s.traffic::text AS traffic,
                s.starts_at, s.ends_at, s.panel_client_id
         FROM subscriptions s
         JOIN subscription_types t ON t.id = s.subscription_type_id
         WHERE s.id = $1`,
        [subscriptionRowId]
      );
      await client.query("COMMIT");
      const row = r.rows[0];
      return row ? mapDbRowToSubscription(row, panel.email) : null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Legacy: добавление подписки только в JSONB purchased_keys (без таблицы subscriptions). */
  async addSubscription(userId: number, sub: Subscription): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<UserRow>(
        `SELECT tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at
         FROM users WHERE tg_id = $1 FOR UPDATE`,
        [userId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return;
      }
      const list = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as Subscription[];
      list.push(sub);
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, updated_at = NOW() WHERE tg_id = $1`,
        [userId, JSON.stringify(list)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async addTrafficToSubscription(
    userId: number,
    subscriptionId: string,
    trafficGb: number
  ): Promise<boolean> {
    const addBytes = gbToBytes(trafficGb);

    if (/^\d+$/.test(subscriptionId)) {
      const subId = parseInt(subscriptionId, 10);
      const dbUserId = await this.getDbUserIdByTgId(userId);
      if (dbUserId === null) {
        return false;
      }
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const u = await client.query<{ traffic_wallet_gb: number | null }>(
          `SELECT traffic_wallet_gb FROM users WHERE tg_id = $1 FOR UPDATE`,
          [userId]
        );
        const row = u.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return false;
        }
        const upd = await client.query(
          `UPDATE subscriptions SET traffic = COALESCE(traffic, 0) + $1, updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [addBytes, subId, dbUserId]
        );
        if ((upd.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          return false;
        }
        const wallet = (row.traffic_wallet_gb ?? 0) + trafficGb;
        await client.query(
          `UPDATE users SET traffic_wallet_gb = $2, updated_at = NOW() WHERE tg_id = $1`,
          [userId, wallet]
        );
        await client.query("COMMIT");
        return true;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<UserRow>(
        `SELECT tg_id, purchased_keys, traffic_wallet_gb
         FROM users WHERE tg_id = $1 FOR UPDATE`,
        [userId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const list = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as Subscription[];
      const sub = list.find((s) => s.id === subscriptionId);
      if (!sub) {
        await client.query("ROLLBACK");
        return false;
      }
      sub.totalTrafficGb = (sub.totalTrafficGb ?? 0) + trafficGb;
      if (typeof sub.usedTrafficGb !== "number") {
        sub.usedTrafficGb = 0;
      }
      const wallet = (row.traffic_wallet_gb ?? 0) + trafficGb;
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, traffic_wallet_gb = $3, updated_at = NOW()
         WHERE tg_id = $1`,
        [userId, JSON.stringify(list), wallet]
      );
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  isSubscriptionExpired(sub: Subscription): boolean {
    return new Date(sub.expiresAt).getTime() <= Date.now();
  }

  async getActiveSubscriptions(userId: number): Promise<Subscription[]> {
    const user = await this.findById(userId);
    if (!user) return [];
    return user.subscriptions.filter((s) => !this.isSubscriptionExpired(s));
  }
}
