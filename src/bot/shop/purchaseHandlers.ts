import { UserService } from "../../services/UserService";
import { KeyService } from "../../services/KeyService";
import { TrafficService } from "../../services/TrafficService";

export interface PurchaseResult {
  success: boolean;
  details: string;
}

interface PurchaseOptions {
  targetKeyId?: string;
}

type PurchaseHandler = (userId: number, options?: PurchaseOptions) => PurchaseResult;

const userService = new UserService();
const keyService = new KeyService();
const trafficService = new TrafficService();

const purchaseHandlers: Record<string, PurchaseHandler> = {
  api_key_1m: (userId: number): PurchaseResult => {
    const newKey = keyService.generateKey(1);
    userService.addKeyToUser(userId, newKey);

    return {
      success: true,
      details:
        `🔑 Ваш новый API-ключ:\n<code>${newKey.value}</code>\n` +
        `⏳ Срок: <b>1 месяц</b>\n` +
        `📅 Действует до: <b>${new Date(newKey.expiresAt ?? "").toLocaleDateString("ru-RU")}</b>`,
    };
  },
  api_key_3m: (userId: number): PurchaseResult => {
    const newKey = keyService.generateKey(3);
    userService.addKeyToUser(userId, newKey);

    return {
      success: true,
      details:
        `🔑 Ваш новый API-ключ:\n<code>${newKey.value}</code>\n` +
        `⏳ Срок: <b>3 месяца</b>\n` +
        `📅 Действует до: <b>${new Date(newKey.expiresAt ?? "").toLocaleDateString("ru-RU")}</b>`,
    };
  },
  api_key_12m: (userId: number): PurchaseResult => {
    const newKey = keyService.generateKey(12);
    userService.addKeyToUser(userId, newKey);

    return {
      success: true,
      details:
        `🔑 Ваш новый API-ключ:\n<code>${newKey.value}</code>\n` +
        `⏳ Срок: <b>12 месяцев</b>\n` +
        `📅 Действует до: <b>${new Date(newKey.expiresAt ?? "").toLocaleDateString("ru-RU")}</b>`,
    };
  },
};

export function executePurchase(itemId: string, userId: number, options?: PurchaseOptions): PurchaseResult {
  const handler = purchaseHandlers[itemId];
  const trafficGb = trafficService.parseGbFromItemId(itemId);

  if (trafficGb !== null) {
    if (!options?.targetKeyId) {
      return {
        success: false,
        details: "Для покупки трафика нужно выбрать ключ.",
      };
    }

    const attached = userService.addTrafficToKey(userId, options.targetKeyId, trafficGb);
    if (!attached) {
      return {
        success: false,
        details: "Выбранный ключ не найден.",
      };
    }

    const trafficCode = trafficService.getTrafficCode(trafficGb);
    return {
      success: true,
      details: `🌐 Трафик <b>+${trafficGb} GB</b> привязан к выбранному ключу.\n🧩 Пакет: <code>${trafficCode}</code>`,
    };
  }

  if (!handler) {
    return {
      success: false,
      details: "Товар временно недоступен.",
    };
  }

  return handler(userId, options);
}
