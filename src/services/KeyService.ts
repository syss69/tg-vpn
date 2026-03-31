import { randomBytes } from "crypto";
import { ApiKey } from "../types";

export const KEY_PLAN_1M_PRICE = 500;
export const KEY_PLAN_3M_PRICE = 1300;
export const KEY_PLAN_12M_PRICE = 4200;

/**
 * Сервис для работы с API-ключами.
 * Отвечает за генерацию уникальных ключей.
 */
export class KeyService {
  /**
   * Генерирует уникальный API-ключ в формате:
   * `APIKEY-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
   * @returns Объект ApiKey с уникальным значением и датой создания
   */
  generateKey(planMonths: number): ApiKey {
    // Генерируем случайные байты и переводим в hex-строку
    const rawHex = randomBytes(16).toString("hex").toUpperCase();

    // Форматируем в читаемый вид: APIKEY-XXXX-XXXX-XXXX-XXXXXXXXXXXX
    const formatted = `APIKEY-${rawHex.slice(0, 4)}-${rawHex.slice(4, 8)}-${rawHex.slice(8, 12)}-${rawHex.slice(12, 24)}`;

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + planMonths);

    return {
      id: randomBytes(8).toString("hex"),
      value: formatted,
      planMonths,
      expiresAt: expiresAt.toISOString(),
      totalTrafficGb: 0,
      usedTrafficGb: 0,
      purchasedAt: now.toISOString(),
    };
  }
}
