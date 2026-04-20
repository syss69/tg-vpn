import { randomBytes } from "crypto";

const DEFAULT_SUBSCRIPTION_BASE_URL = "https://main.co190.com:50000";

/**
 * Генерация ссылки на подписку для клиента.
 * Формат: `{base}/api/sub/{token}` (Remnawave / панель).
 */
export class SubscriptionService {
  /**
   * База URL без завершающего слэша: `SUBSCRIPTION_BASE_URL` или значение по умолчанию.
   */
  private subscriptionBaseUrl(): string {
    const raw = process.env.SUBSCRIPTION_BASE_URL?.trim();
    const base = (raw && raw.length > 0 ? raw : DEFAULT_SUBSCRIPTION_BASE_URL).replace(/\/$/, "");
    return base;
  }

  /**
   * Токен в пути (например `moh0PesjMmqpFqjW`).
   */
  private randomSubToken(): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const buf = randomBytes(16);
    let s = "";
    for (let i = 0; i < 16; i++) {
      s += alphabet[buf[i]! % alphabet.length];
    }
    return s;
  }

  /**
   * Полная ссылка подписки и токен для учёта / API панели.
   */
  generateSubscriptionLink(): { subscriptionUrl: string; token: string } {
    const token = this.randomSubToken();
    const subscriptionUrl = `${this.subscriptionBaseUrl()}/api/sub/${token}`;
    return { subscriptionUrl, token };
  }
}
