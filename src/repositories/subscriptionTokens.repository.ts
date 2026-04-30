import { Pool } from "pg";

export type SubscriptionTokenRow = {
  id: string;
  subscription_id: number;
  token: string;
  is_active: boolean;
  expires_at: Date | null;
  last_ip: string | null;
  last_user_agent: string | null;
  requests_count: number;
  created_at: Date;
  updated_at: Date;
};

export type SubscriptionTokenWithSubscriptionRow = {
  token_id: string;
  subscription_id: number;
  token: string;
  token_is_active: boolean;
  token_expires_at: Date | null;
  last_ip: string | null;
  last_user_agent: string | null;
  requests_count: number;
  token_created_at: Date;
  token_updated_at: Date;

  subscription_raw_subscription_url: string | null;
  subscription_ends_at: Date | null;
  subscription_status: string | null;
};

export class SubscriptionTokensRepository {
  constructor(private readonly pool: Pool) {}

  async create(params: {
    subscriptionId: number;
    token: string;
    expiresAt?: Date | null;
  }): Promise<SubscriptionTokenRow> {
    const { subscriptionId, token, expiresAt = null } = params;

    const result = await this.pool.query<SubscriptionTokenRow>(
      `
      INSERT INTO subscription_tokens (
        subscription_id,
        token,
        expires_at
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [subscriptionId, token, expiresAt]
    );

    return result.rows[0];
  }

  async findByToken(token: string): Promise<SubscriptionTokenRow | null> {
    const result = await this.pool.query<SubscriptionTokenRow>(
      `
      SELECT *
      FROM subscription_tokens
      WHERE token = $1
      LIMIT 1
      `,
      [token]
    );

    return result.rows[0] ?? null;
  }

  async findByTokenWithSubscription(
    token: string
  ): Promise<SubscriptionTokenWithSubscriptionRow | null> {
    const result = await this.pool.query<SubscriptionTokenWithSubscriptionRow>(
      `
      SELECT
        st.id AS token_id,
        st.subscription_id,
        st.token,
        st.is_active AS token_is_active,
        st.expires_at AS token_expires_at,
        st.last_ip,
        st.last_user_agent,
        st.requests_count,
        st.created_at AS token_created_at,
        st.updated_at AS token_updated_at,

        s.raw_subscription_url AS subscription_raw_subscription_url,
        s.ends_at AS subscription_ends_at,
        s.status AS subscription_status
      FROM subscription_tokens st
      JOIN subscriptions s ON s.id = st.subscription_id
      WHERE st.token = $1
      LIMIT 1
      `,
      [token]
    );

    return result.rows[0] ?? null;
  }

  async touchTokenUsage(params: {
    token: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    const { token, ip, userAgent } = params;

    await this.pool.query(
      `
      UPDATE subscription_tokens
      SET
        last_ip = $1,
        last_user_agent = $2,
        requests_count = requests_count + 1,
        updated_at = NOW()
      WHERE token = $3
      `,
      [ip, userAgent, token]
    );
  }

  async deactivateBySubscriptionId(subscriptionId: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE subscription_tokens
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE subscription_id = $1
      `,
      [subscriptionId]
    );
  }
}
