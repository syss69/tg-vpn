import { SubscriptionTokensRepository } from "../repositories/subscriptionTokens.repository";

type SubscriptionProxySuccess = {
  ok: true;
  body: string;
  contentType: string;
};

type SubscriptionProxyError = {
  ok: false;
  status: number;
  message: string;
};

type SubscriptionProxyResult =
  | SubscriptionProxySuccess
  | SubscriptionProxyError;

export class SubscriptionProxyService {
  constructor(
    private readonly subscriptionTokensRepository: SubscriptionTokensRepository
  ) {}

  async getSubscriptionContent(params: {
    token: string;
    ip: string | null;
    userAgent: string | null;
    clientHeaders?: {
      userAgent?: string | null;
      accept?: string | null;
      acceptEncoding?: string | null;
      acceptLanguage?: string | null;
      connection?: string | null;
      xHwid?: string | null;
      xDeviceOs?: string | null;
      xVerOs?: string | null;
      xDeviceModel?: string | null;
    };
  }): Promise<SubscriptionProxyResult> {
    const { token, ip, userAgent } = params;

    const row =
      await this.subscriptionTokensRepository.findByTokenWithSubscription(token);

    if (!row) {
      return {
        ok: false,
        status: 404,
        message: "Invalid token",
      };
    }

    if (!row.token_is_active) {
      return {
        ok: false,
        status: 403,
        message: "Token disabled",
      };
    }

    if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
      return {
        ok: false,
        status: 403,
        message: "Token expired",
      };
    }

    if (
      row.subscription_status &&
      !["active", "ACTIVE"].includes(row.subscription_status)
    ) {
      return {
        ok: false,
        status: 403,
        message: "Subscription inactive",
      };
    }

    if (
      row.subscription_ends_at &&
      new Date(row.subscription_ends_at) < new Date()
    ) {
      return {
        ok: false,
        status: 403,
        message: "Subscription expired",
      };
    }

    const rawSubscriptionUrl = row.subscription_raw_subscription_url?.trim();

    if (!rawSubscriptionUrl) {
      return {
        ok: false,
        status: 404,
        message: "Subscription source is missing",
      };
    }

    const upstreamHeaders: Record<string, string> = {};

    if (params.clientHeaders?.userAgent) upstreamHeaders["User-Agent"] = params.clientHeaders.userAgent;
    else if (userAgent?.trim()) upstreamHeaders["User-Agent"] = userAgent.trim();
    else upstreamHeaders["User-Agent"] = "Happ/2.9.0";

    if (params.clientHeaders?.accept) upstreamHeaders["Accept"] = params.clientHeaders.accept;
    if (params.clientHeaders?.acceptEncoding) upstreamHeaders["Accept-Encoding"] = params.clientHeaders.acceptEncoding;
    if (params.clientHeaders?.acceptLanguage) upstreamHeaders["Accept-Language"] = params.clientHeaders.acceptLanguage;
    if (params.clientHeaders?.connection) upstreamHeaders["Connection"] = params.clientHeaders.connection;
    if (params.clientHeaders?.xHwid) upstreamHeaders["x-hwid"] = params.clientHeaders.xHwid;
    if (params.clientHeaders?.xDeviceOs) upstreamHeaders["x-device-os"] = params.clientHeaders.xDeviceOs;
    if (params.clientHeaders?.xVerOs) upstreamHeaders["x-ver-os"] = params.clientHeaders.xVerOs;
    if (params.clientHeaders?.xDeviceModel) upstreamHeaders["x-device-model"] = params.clientHeaders.xDeviceModel;

    const upstreamResponse = await fetch(rawSubscriptionUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    if (!upstreamResponse.ok) {
      return {
        ok: false,
        status: 502,
        message: `Upstream error: ${upstreamResponse.status}`,
      };
    }

    const body = await upstreamResponse.text();
    const contentType =
      upstreamResponse.headers.get("content-type") ??
      "text/plain; charset=utf-8";

    await this.subscriptionTokensRepository.touchTokenUsage({
      token,
      ip,
      userAgent,
    });

    return {
      ok: true,
      body,
      contentType,
    };
  }
}
