import { Pool } from "pg";
import { getPool } from "../db/pool";
import { ApiKey, User } from "../types";

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
  const keys = Array.isArray(raw) ? raw : [];
  return {
    id: row.tg_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    languageCode: row.language_code ?? undefined,
    balance: row.balance,
    purchasedKeys: keys as ApiKey[],
    trafficWalletGb: row.traffic_wallet_gb ?? 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Сервис пользователей: PostgreSQL (таблица users + purchased_keys JSONB до полного перехода на subscriptions).
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

  async addKeyToUser(userId: number, key: ApiKey): Promise<void> {
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
      const keys = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as ApiKey[];
      keys.push(key);
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, updated_at = NOW() WHERE tg_id = $1`,
        [userId, JSON.stringify(keys)]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async addTrafficToKey(
    userId: number,
    keyId: string,
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
      const keys = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as ApiKey[];
      const key = keys.find((k) => k.id === keyId);
      if (!key) {
        await client.query("ROLLBACK");
        return false;
      }
      key.totalTrafficGb = (key.totalTrafficGb ?? 0) + trafficGb;
      if (typeof key.usedTrafficGb !== "number") {
        key.usedTrafficGb = 0;
      }
      const wallet = (row.traffic_wallet_gb ?? 0) + trafficGb;
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, traffic_wallet_gb = $3, updated_at = NOW()
         WHERE tg_id = $1`,
        [userId, JSON.stringify(keys), wallet]
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

  isKeyExpired(key: ApiKey): boolean {
    if (!key.expiresAt) return false;
    return new Date(key.expiresAt).getTime() <= Date.now();
  }

  async getActiveKeys(userId: number): Promise<ApiKey[]> {
    const user = await this.findById(userId);
    if (!user) return [];
    return user.purchasedKeys.filter((key) => !this.isKeyExpired(key));
  }

  async reduceTrafficByKeyNumber(
    userId: number,
    keyNumber: number,
    gb: number
  ): Promise<{
    success: boolean;
    reason?: string;
    keyValue?: string;
    remainingGb?: number;
    usedGb?: number;
    totalGb?: number;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<UserRow>(
        `SELECT tg_id, purchased_keys FROM users WHERE tg_id = $1 FOR UPDATE`,
        [userId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Пользователь не найден." };
      }
      const keys = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as ApiKey[];
      if (keyNumber < 1 || keyNumber > keys.length) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Неверный номер ключа." };
      }
      const key = keys[keyNumber - 1];
      if (this.isKeyExpired(key)) {
        await client.query("ROLLBACK");
        return {
          success: false,
          reason: "Ключ сгорел. С него нельзя списывать трафик.",
        };
      }
      const total = key.totalTrafficGb ?? 0;
      const used = key.usedTrafficGb ?? 0;
      const remaining = Math.max(total - used, 0);
      if (gb > remaining) {
        await client.query("ROLLBACK");
        return {
          success: false,
          reason: `Недостаточно трафика. Остаток: ${remaining} GB.`,
        };
      }
      key.usedTrafficGb = used + gb;
      const nextRemaining = Math.max(total - (key.usedTrafficGb ?? 0), 0);
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, updated_at = NOW() WHERE tg_id = $1`,
        [userId, JSON.stringify(keys)]
      );
      await client.query("COMMIT");
      return {
        success: true,
        keyValue: key.value,
        remainingGb: nextRemaining,
        usedGb: key.usedTrafficGb,
        totalGb: total,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async rebindRemainingTrafficByNumbers(
    userId: number,
    fromKeyNumber: number,
    toKeyNumber: number
  ): Promise<{
    success: boolean;
    reason?: string;
    movedGb?: number;
    fromKey?: string;
    toKey?: string;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<UserRow>(
        `SELECT tg_id, purchased_keys FROM users WHERE tg_id = $1 FOR UPDATE`,
        [userId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Пользователь не найден." };
      }
      const keys = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as ApiKey[];
      if (
        fromKeyNumber < 1 ||
        toKeyNumber < 1 ||
        fromKeyNumber > keys.length ||
        toKeyNumber > keys.length
      ) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Неверные номера ключей." };
      }
      const fromKey = keys[fromKeyNumber - 1];
      const toKey = keys[toKeyNumber - 1];
      if (fromKey.id === toKey.id) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Нужно выбрать разные ключи." };
      }
      if (!this.isKeyExpired(fromKey)) {
        await client.query("ROLLBACK");
        return {
          success: false,
          reason:
            "Источник не сгорел. Перепривязка доступна только для сгоревшего ключа.",
        };
      }
      if (this.isKeyExpired(toKey)) {
        await client.query("ROLLBACK");
        return {
          success: false,
          reason: "Целевой ключ тоже сгорел. Нужен активный ключ.",
        };
      }
      const fromTotal = fromKey.totalTrafficGb ?? 0;
      const fromUsed = fromKey.usedTrafficGb ?? 0;
      const remaining = Math.max(fromTotal - fromUsed, 0);
      if (remaining <= 0) {
        await client.query("ROLLBACK");
        return {
          success: false,
          reason: "На сгоревшем ключе нет остатка для переноса.",
        };
      }
      fromKey.totalTrafficGb = fromUsed;
      toKey.totalTrafficGb = (toKey.totalTrafficGb ?? 0) + remaining;
      if (typeof toKey.usedTrafficGb !== "number") {
        toKey.usedTrafficGb = 0;
      }
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, updated_at = NOW() WHERE tg_id = $1`,
        [userId, JSON.stringify(keys)]
      );
      await client.query("COMMIT");
      return {
        success: true,
        movedGb: remaining,
        fromKey: fromKey.value,
        toKey: toKey.value,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteKeyByNumber(
    userId: number,
    keyNumber: number
  ): Promise<{
    success: boolean;
    reason?: string;
    keyValue?: string;
    wasExpired?: boolean;
    remainingTrafficGb?: number;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<UserRow>(
        `SELECT tg_id, purchased_keys FROM users WHERE tg_id = $1 FOR UPDATE`,
        [userId]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Пользователь не найден." };
      }
      const keys = (Array.isArray(row.purchased_keys) ? row.purchased_keys : []) as ApiKey[];
      if (keyNumber < 1 || keyNumber > keys.length) {
        await client.query("ROLLBACK");
        return { success: false, reason: "Неверный номер ключа." };
      }
      const key = keys[keyNumber - 1];
      const total = key.totalTrafficGb ?? 0;
      const used = key.usedTrafficGb ?? 0;
      const remaining = Math.max(total - used, 0);
      const wasExpired = this.isKeyExpired(key);
      keys.splice(keyNumber - 1, 1);
      await client.query(
        `UPDATE users SET purchased_keys = $2::jsonb, updated_at = NOW() WHERE tg_id = $1`,
        [userId, JSON.stringify(keys)]
      );
      await client.query("COMMIT");
      return {
        success: true,
        keyValue: key.value,
        wasExpired,
        remainingTrafficGb: remaining,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
