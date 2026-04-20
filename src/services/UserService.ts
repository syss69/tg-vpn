import { Pool } from "pg";
import { getPool } from "../db/pool";
import { Subscription, User } from "../types";

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

function rowToUser(row: UserRow): User {
  const raw = row.purchased_keys;
  const subs = Array.isArray(raw) ? raw : [];
  return {
    id: row.tg_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    languageCode: row.language_code ?? undefined,
    balance: row.balance,
    subscriptions: subs as Subscription[],
    trafficWalletGb: row.traffic_wallet_gb ?? 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Сервис пользователей: PostgreSQL (таблица users, подписки в JSONB purchased_keys).
 */
export class UserService {
  private get pool(): Pool {
    return getPool();
  }

  async findById(userId: number): Promise<User | undefined> {
    const res = await this.pool.query<UserRow>(
      `SELECT tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at
       FROM users WHERE tg_id = $1`,
      [userId]
    );
    const row = res.rows[0];
    return row ? rowToUser(row) : undefined;
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
    return rowToUser(res.rows[0]);
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
    return rowToUser(res.rows[0]);
  }

  /**
   * Первый /start: сохраняет пользователя в БД, если записи ещё нет (без обновления существующих).
   */
  async ensureUserOnBotStart(params: {
    tgId: number;
    username?: string;
    firstName?: string;
    languageCode?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (tg_id, username, first_name, language_code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tg_id) DO NOTHING`,
      [
        params.tgId,
        params.username ?? null,
        params.firstName ?? null,
        params.languageCode ?? null,
      ]
    );
  }

  async topUpBalance(userId: number, amount: number): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      `UPDATE users SET balance = balance + $2, updated_at = NOW()
       WHERE tg_id = $1
       RETURNING tg_id, username, first_name, language_code, balance, purchased_keys, traffic_wallet_gb, created_at`,
      [userId, amount]
    );
    const row = res.rows[0];
    return row ? rowToUser(row) : null;
  }

  async deductBalance(userId: number, amount: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE users SET balance = balance - $2, updated_at = NOW()
       WHERE tg_id = $1 AND balance >= $2`,
      [userId, amount]
    );
    return (res.rowCount ?? 0) > 0;
  }

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
