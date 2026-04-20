import { randomBytes } from "crypto";
import { RemnawaveClient, gbToBytes } from "./RemnawaveClient";
import { SubscriptionService } from "./SubscriptionService";

function useRemnawave(): boolean {
  return Boolean(
    process.env.REMNAWAVE_BASE_URL?.trim() || process.env.REMNAWAVE_PANEL_URL?.trim()
  );
}

function trafficStrategy(): "NO_RESET" | "DAY" | "WEEK" | "MONTH" {
  const s = process.env.REMNAWAVE_TRAFFIC_LIMIT_STRATEGY?.trim().toUpperCase();
  if (s === "DAY" || s === "WEEK" || s === "MONTH" || s === "NO_RESET") {
    return s;
  }
  return "NO_RESET";
}

/**
 * Интеграция с панелью: Remnawave (REST API + Bearer), если задан REMNAWAVE_BASE_URL.
 * Иначе — локальная заглушка без сети (для разработки без панели).
 */
export class PanelApiService {
  private readonly remnawave = new RemnawaveClient();

  /**
   * Для 3x-ui это был id инбаунда; у Remnawave не используется — возвращаем 1, чтобы не ломать проверки в purchaseHandlers.
   */
  getInboundId(): number | null {
    if (useRemnawave()) {
      return 1;
    }
    const raw = process.env.PANEL_INBOUND_ID;
    if (raw === undefined || raw === "") return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Создаёт пользователя в Remnawave и возвращает ссылку подписки из ответа API.
   */
  async createClientForSubscriptionPeriod(
    telegramUserId: number,
    durationDays: number,
    options?: { initialTrafficGb?: number }
  ): Promise<
    | { ok: true; clientId: string; email: string; subscriptionUrl: string }
    | { ok: false; error: string }
  > {
    if (!useRemnawave()) {
      return this.createClientStub(telegramUserId);
    }

    const username = RemnawaveClient.makeUsername(telegramUserId);
    const exp = new Date();
    exp.setDate(exp.getDate() + durationDays);
    const expireAtIso = exp.toISOString();
    const initialGb = options?.initialTrafficGb ?? 0;

    const email =
      process.env.REMNAWAVE_USER_EMAIL_DOMAIN?.trim() !== undefined
        ? `u${telegramUserId}-${randomBytes(3).toString("hex")}@${process.env.REMNAWAVE_USER_EMAIL_DOMAIN!.replace(/^@/, "")}`
        : undefined;

    const createParams: Parameters<RemnawaveClient["createUser"]>[0] = {
      username,
      expireAtIso,
      telegramId: telegramUserId,
      email,
      trafficLimitStrategy: trafficStrategy(),
    };
    if (initialGb > 0) {
      createParams.trafficLimitBytes = gbToBytes(initialGb);
    }

    const created = await this.remnawave.createUser(createParams);
    if (!created.ok) {
      return { ok: false, error: created.error };
    }

    return {
      ok: true,
      clientId: created.user.uuid,
      email: created.user.email ?? `u${telegramUserId}@remnawave.bot`,
      subscriptionUrl: created.user.subscriptionUrl,
    };
  }

  private createClientStub(
    telegramUserId: number
  ): Promise<
    { ok: true; clientId: string; email: string; subscriptionUrl: string } | { ok: false; error: string }
  > {
    const subscriptionService = new SubscriptionService();
    const { subscriptionUrl, token } = subscriptionService.generateSubscriptionLink();
    const email = `stub-${telegramUserId}-${randomBytes(4).toString("hex")}@remnawave.placeholder`;
    return Promise.resolve({
      ok: true,
      clientId: token,
      email,
      subscriptionUrl,
    });
  }

  /**
   * Увеличивает лимит трафика пользователя (bytes) в Remnawave.
   */
  async addTrafficGb(
    _inboundId: number,
    clientId: string,
    _email: string,
    addGb: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!useRemnawave()) {
      return { ok: true };
    }

    const current = await this.remnawave.getUserByUuid(clientId);
    if (!current.ok) {
      return { ok: false, error: current.error };
    }
    const addBytes = gbToBytes(addGb);
    const prev = current.user.trafficLimitBytes ?? 0;
    const next = prev + addBytes;
    const updated = await this.remnawave.updateUserTrafficLimitBytes(clientId, next);
    if (!updated.ok) {
      return { ok: false, error: updated.error };
    }
    return { ok: true };
  }
}
