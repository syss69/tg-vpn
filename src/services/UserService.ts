import { Pool } from "pg";
import { randomBytes } from "crypto";
import { getPool } from "../db/pool";
import { Subscription, User } from "../types";
import { gbToBytes } from "./RemnawaveClient";
import { createSubscriptionToken } from "./createSubscriptionToken.service";

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
  subscription_token: string | null;
  public_token: string | null;
  raw_subscription_url: string | null;
  traffic: string | null;
  starts_at: Date;
  ends_at: Date;
  panel_client_id: string | null;
}

interface SubscriptionByPublicTokenRow {
  subscription_id: number;
  tg_id: number;
  plan_id: string;
  plan_title: string;
  panel_client_id: string | null;
  public_token: string | null;
  raw_subscription_url: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  traffic: string | null;
}

interface SubscriptionByInstallTokenRow {
  subscription_id: number;
  tg_id: number;
  plan_id: string;
  plan_title: string;
  panel_client_id: string | null;
  public_token: string | null;
  raw_subscription_url: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  traffic: string | null;
  proxy_token: string;
}

function buildInstallUrlByToken(token: string): string {
  const baseRaw = process.env.APP_BASE_URL?.trim();
  if (baseRaw && baseRaw.length > 0) {
    const base = baseRaw.replace(/\/$/, "");
    return `${base}/key/${token}`;
  }
  return `/key/${token}`;
}

function mapDbRowToSubscription(
  row: SubscriptionDbRow,
  panelEmail: string,
  overrideToken?: string
): Subscription {
  const trafficBytes = row.traffic != null && row.traffic !== "" ? Number(row.traffic) : 0;
  const totalTrafficGb = trafficBytes > 0 ? trafficBytes / (1024 * 1024 * 1024) : 0;
  const installToken = overrideToken ?? row.subscription_token ?? row.public_token;
  const subscriptionUrl = installToken ? buildInstallUrlByToken(installToken) : "";
  return {
    id: String(row.id),
    planId: row.plan_id,
    planTitle: row.plan_title,
    panelClientUuid: row.panel_client_id ?? "",
    panelEmail,
    subscriptionUrl,
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

  /** Публичный URL-safe токен для install-ссылки (/key/:token). */
  private generatePublicToken(byteLength = 18): string {
    return randomBytes(byteLength).toString("base64url");
  }

  /** Внутренний id строки users.id по Telegram id (subscriptions.user_id ссылается на него). */
  private async getDbUserIdByTgId(tgId: number): Promise<number | null> {
    const r = await this.pool.query<{ id: number }>(`SELECT id FROM users WHERE tg_id = $1`, [tgId]);
    return r.rows[0]?.id ?? null;
  }

  private async loadSubscriptionsFromDatabase(tgId: number): Promise<Subscription[]> {
    const res = await this.pool.query<SubscriptionDbRow>(
      `SELECT s.id, t.code AS plan_id, t.name AS plan_title,
              st.token AS subscription_token,
              s.public_token, s.raw_subscription_url, s.traffic::text AS traffic,
              s.starts_at, s.ends_at, s.panel_client_id
       FROM subscriptions s
       JOIN subscription_types t ON t.id = s.subscription_type_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN LATERAL (
         SELECT st.token
         FROM subscription_tokens st
         WHERE st.subscription_id = s.id
           AND st.is_active = TRUE
           AND (st.expires_at IS NULL OR st.expires_at > NOW())
         ORDER BY st.created_at DESC
         LIMIT 1
       ) st ON true
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

  async findSubscriptionByPublicToken(token: string): Promise<{
    subscriptionId: string;
    tgUserId: number;
    planId: string;
    planTitle: string;
    panelClientUuid: string;
    panelEmail: string;
    publicToken: string;
    rawSubscriptionUrl: string;
    expiresAt: string;
    purchasedAt: string;
    status: string;
    totalTrafficGb: number;
    usedTrafficGb: number;
  } | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(normalizedToken)) return null;

    const res = await this.pool.query<SubscriptionByPublicTokenRow>(
      `SELECT s.id AS subscription_id,
              u.tg_id,
              t.code AS plan_id,
              t.name AS plan_title,
              s.panel_client_id,
              s.public_token,
              s.raw_subscription_url,
              s.starts_at,
              s.ends_at,
              s.status,
              s.traffic::text AS traffic
       FROM subscriptions s
       JOIN subscription_types t ON t.id = s.subscription_type_id
       JOIN users u ON u.id = s.user_id
       WHERE s.public_token = $1
       LIMIT 1`,
      [normalizedToken]
    );
    const row = res.rows[0];
    if (!row || !row.public_token) return null;

    const trafficBytes = row.traffic != null && row.traffic !== "" ? Number(row.traffic) : 0;
    const totalTrafficGb = trafficBytes > 0 ? trafficBytes / (1024 * 1024 * 1024) : 0;

    return {
      subscriptionId: String(row.subscription_id),
      tgUserId: row.tg_id,
      planId: row.plan_id,
      planTitle: row.plan_title,
      panelClientUuid: row.panel_client_id ?? "",
      panelEmail: "",
      publicToken: row.public_token,
      rawSubscriptionUrl: row.raw_subscription_url ?? "",
      expiresAt: row.ends_at.toISOString(),
      purchasedAt: row.starts_at.toISOString(),
      status: row.status,
      totalTrafficGb,
      usedTrafficGb: 0,
    };
  }

  private async findLatestActiveSubscriptionToken(subscriptionId: number): Promise<string | null> {
    const tokenRes = await this.pool.query<{ token: string }>(
      `SELECT st.token
       FROM subscription_tokens st
       WHERE st.subscription_id = $1
         AND st.is_active = TRUE
         AND (st.expires_at IS NULL OR st.expires_at > NOW())
       ORDER BY st.created_at DESC
       LIMIT 1`,
      [subscriptionId]
    );
    return tokenRes.rows[0]?.token ?? null;
  }

  async findSubscriptionByInstallToken(token: string): Promise<{
    subscriptionId: string;
    tgUserId: number;
    planId: string;
    planTitle: string;
    panelClientUuid: string;
    panelEmail: string;
    publicToken: string;
    rawSubscriptionUrl: string;
    expiresAt: string;
    purchasedAt: string;
    status: string;
    totalTrafficGb: number;
    usedTrafficGb: number;
    proxyToken: string;
  } | null> {
    const normalizedToken = token.trim();
    if (!normalizedToken) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(normalizedToken)) return null;

    const tokenRes = await this.pool.query<SubscriptionByInstallTokenRow>(
      `SELECT s.id AS subscription_id,
              u.tg_id,
              t.code AS plan_id,
              t.name AS plan_title,
              s.panel_client_id,
              s.public_token,
              s.raw_subscription_url,
              s.starts_at,
              s.ends_at,
              s.status,
              s.traffic::text AS traffic,
              st.token AS proxy_token
       FROM subscription_tokens st
       JOIN subscriptions s ON s.id = st.subscription_id
       JOIN subscription_types t ON t.id = s.subscription_type_id
       JOIN users u ON u.id = s.user_id
       WHERE st.token = $1
         AND st.is_active = TRUE
         AND (st.expires_at IS NULL OR st.expires_at > NOW())
       LIMIT 1`,
      [normalizedToken]
    );
    const tokenRow = tokenRes.rows[0];

    if (tokenRow) {
      const trafficBytes = tokenRow.traffic != null && tokenRow.traffic !== "" ? Number(tokenRow.traffic) : 0;
      const totalTrafficGb = trafficBytes > 0 ? trafficBytes / (1024 * 1024 * 1024) : 0;

      return {
        subscriptionId: String(tokenRow.subscription_id),
        tgUserId: tokenRow.tg_id,
        planId: tokenRow.plan_id,
        planTitle: tokenRow.plan_title,
        panelClientUuid: tokenRow.panel_client_id ?? "",
        panelEmail: "",
        publicToken: tokenRow.public_token ?? "",
        rawSubscriptionUrl: tokenRow.raw_subscription_url ?? "",
        expiresAt: tokenRow.ends_at.toISOString(),
        purchasedAt: tokenRow.starts_at.toISOString(),
        status: tokenRow.status,
        totalTrafficGb,
        usedTrafficGb: 0,
        proxyToken: tokenRow.proxy_token,
      };
    }

    const legacySubscription = await this.findSubscriptionByPublicToken(normalizedToken);
    if (!legacySubscription) {
      return null;
    }

    const latestActiveToken = await this.findLatestActiveSubscriptionToken(Number(legacySubscription.subscriptionId));
    return {
      ...legacySubscription,
      proxyToken: latestActiveToken ?? legacySubscription.publicToken,
    };
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
    } catch (e) {
      console.warn("[UserService] createPendingSubscription failed:", e);
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
    let committed = false;
    try {
      await client.query("BEGIN");
      const publicToken = this.generatePublicToken();
      const upd = await client.query(
        `UPDATE subscriptions SET
          status = 'active',
          panel_client_id = $2,
          public_token = $3,
          raw_subscription_url = $4,
          updated_at = NOW()
        WHERE id = $1 AND user_id = $5 AND status = 'pending_payment'
        RETURNING id`,
        [subscriptionRowId, panel.clientId, publicToken, panel.subscriptionUrl, dbUserId]
      );
      if ((upd.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const r = await client.query<SubscriptionDbRow>(
        `SELECT s.id, t.code AS plan_id, t.name AS plan_title,
                st.token AS subscription_token,
                s.public_token, s.raw_subscription_url, s.traffic::text AS traffic,
                s.starts_at, s.ends_at, s.panel_client_id
         FROM subscriptions s
         JOIN subscription_types t ON t.id = s.subscription_type_id
         LEFT JOIN LATERAL (
           SELECT st.token
           FROM subscription_tokens st
           WHERE st.subscription_id = s.id
             AND st.is_active = TRUE
             AND (st.expires_at IS NULL OR st.expires_at > NOW())
           ORDER BY st.created_at DESC
           LIMIT 1
         ) st ON true
         WHERE s.id = $1`,
        [subscriptionRowId]
      );
      await client.query("COMMIT");
      committed = true;
      const row = r.rows[0];
      if (!row) {
        return null;
      }

      const createdToken = await createSubscriptionToken({
        subscriptionId: subscriptionRowId,
        expiresAt: row.ends_at,
      });

      const tokenRes = await this.pool.query<{ token: string }>(
        `SELECT token
         FROM subscription_tokens
         WHERE subscription_id = $1
           AND is_active = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [subscriptionRowId]
      );
      const subscriptionToken = tokenRes.rows[0]?.token ?? createdToken.token;

      return mapDbRowToSubscription(row, panel.email, subscriptionToken);
    } catch (e) {
      if (!committed) {
        await client.query("ROLLBACK");
      }
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
      const r = await this.pool.query<UserRow>(
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
      const r = await this.pool.query<UserRow>(
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
