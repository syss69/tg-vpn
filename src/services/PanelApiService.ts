import { randomBytes } from "crypto";
import { SubscriptionService } from "./SubscriptionService";

/**
 * Заглушка вместо интеграции с панелью (раньше 3x-ui).
 * Сетевые запросы отключены — дальше Remnawave; ссылка подписки — {@link SubscriptionService}.
 */
export class PanelApiService {
  private readonly subscriptionService = new SubscriptionService();

  /**
   * Фиктивный inbound: реальная панель не опрашивается.
   */
  getInboundId(): number | null {
    return 1;
  }

  /**
   * Имитация создания подписки: локальные token + subscription URL.
   */
  async createClientForSubscriptionPeriod(
    telegramUserId: number,
    _durationDays: number
  ): Promise<
    | { ok: true; clientId: string; email: string; subscriptionUrl: string }
    | { ok: false; error: string }
  > {
    const { subscriptionUrl, token } = this.subscriptionService.generateSubscriptionLink();
    const email = `stub-${telegramUserId}-${randomBytes(4).toString("hex")}@remnawave.placeholder`;
    return {
      ok: true,
      clientId: token,
      email,
      subscriptionUrl,
    };
  }

  /**
   * Имитация докупки трафика на панели (без запросов).
   */
  async addTrafficGb(
    _inboundId: number,
    _clientId: string,
    _email: string,
    _addGb: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return { ok: true };
  }
}
