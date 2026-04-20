import { randomBytes } from "crypto";
import { UserService } from "../../services/UserService";
import { TrafficService } from "../../services/TrafficService";
import { PanelApiService } from "../../services/PanelApiService";
import { Subscription } from "../../types";
import { getShopItemById } from "./catalog";

export interface PurchaseResult {
  success: boolean;
  details: string;
}

interface PurchaseOptions {
  targetSubscriptionId?: string;
}

type PurchaseHandler = (
  userId: number,
  options?: PurchaseOptions
) => Promise<PurchaseResult>;

const SUBSCRIPTION_PERIOD_DAYS = 28;

const userService = new UserService();
const trafficService = new TrafficService();
const panelApi = new PanelApiService();

function formatSubscriptionSuccess(sub: Subscription): string {
  return (
    `📋 <b>Подписка активирована</b>\n` +
    `⏳ Период: <b>4 недели</b>\n` +
    `📅 До: <b>${new Date(sub.expiresAt).toLocaleDateString("ru-RU")}</b>\n\n` +
    `🔗 <b>Ссылка подписки</b>:\n<code>${sub.subscriptionUrl}</code>`
  );
}

function buildSubscription(
  planId: string,
  planTitle: string,
  panel: {
    clientId: string;
    email: string;
    subscriptionUrl: string;
  },
  totalTrafficGb: number
): Subscription {
  const now = new Date();
  const exp = new Date(now);
  exp.setDate(exp.getDate() + SUBSCRIPTION_PERIOD_DAYS);
  return {
    id: randomBytes(8).toString("hex"),
    planId,
    planTitle,
    panelClientUuid: panel.clientId,
    panelEmail: panel.email,
    subscriptionUrl: panel.subscriptionUrl,
    expiresAt: exp.toISOString(),
    purchasedAt: now.toISOString(),
    totalTrafficGb,
    usedTrafficGb: 0,
  };
}

async function purchaseSubscriptionTier(
  userId: number,
  planId: string,
  initialTrafficGb: number
): Promise<PurchaseResult> {
  const item = getShopItemById(planId);
  const title = item?.title ?? planId;

  const panel = await panelApi.createClientForSubscriptionPeriod(
    userId,
    SUBSCRIPTION_PERIOD_DAYS
  );
  if (!panel.ok) {
    return { success: false, details: panel.error };
  }

  const inboundId = panelApi.getInboundId();
  if (inboundId === null) {
    return { success: false, details: "На сервере не настроен PANEL_INBOUND_ID." };
  }

  let totalGb = initialTrafficGb;
  if (initialTrafficGb > 0) {
    const added = await panelApi.addTrafficGb(
      inboundId,
      panel.clientId,
      panel.email,
      initialTrafficGb
    );
    if (!added.ok) {
      return { success: false, details: added.error };
    }
  }

  const sub = buildSubscription(planId, title, panel, totalGb);
  await userService.addSubscription(userId, sub);

  return {
    success: true,
    details: formatSubscriptionSuccess(sub),
  };
}

const purchaseHandlers: Record<string, PurchaseHandler> = {
  subscription_compact: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_compact", 15),
  subscription_standard: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_standard", 0),
  subscription_premium: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_premium", 0),
};

export async function executePurchase(
  itemId: string,
  userId: number,
  options?: PurchaseOptions
): Promise<PurchaseResult> {
  const handler = purchaseHandlers[itemId];
  const trafficGb = trafficService.parseGbFromItemId(itemId);

  if (trafficGb !== null) {
    if (!options?.targetSubscriptionId) {
      return {
        success: false,
        details: "Для покупки трафика нужно выбрать подписку.",
      };
    }

    const user = await userService.findById(userId);
    const sub = user?.subscriptions.find((s) => s.id === options.targetSubscriptionId);
    if (!sub) {
      return {
        success: false,
        details: "Выбранная подписка не найдена.",
      };
    }
    if (!sub.panelClientUuid || !sub.panelEmail) {
      return {
        success: false,
        details:
          "У этой подписки нет данных панели. Оформите новую подписку или обратитесь в поддержку.",
      };
    }

    const inboundId = panelApi.getInboundId();
    if (inboundId === null) {
      return {
        success: false,
        details: "На сервере не настроен PANEL_INBOUND_ID.",
      };
    }

    const panel = await panelApi.addTrafficGb(
      inboundId,
      sub.panelClientUuid,
      sub.panelEmail,
      trafficGb
    );
    if (!panel.ok) {
      return { success: false, details: panel.error };
    }

    const attached = await userService.addTrafficToSubscription(
      userId,
      options.targetSubscriptionId,
      trafficGb
    );
    if (!attached) {
      return {
        success: false,
        details:
          "Панель обновлена, но не удалось сохранить подписку в базе бота. Обратитесь в поддержку.",
      };
    }

    const trafficCode = trafficService.getTrafficCode(trafficGb);
    return {
      success: true,
      details:
        `🌐 Трафик <b>+${trafficGb} GB</b> добавлен к подписке.\n🧩 Пакет: <code>${trafficCode}</code>`,
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
