import { UserService } from "../../services/UserService";
import { TrafficService } from "../../services/TrafficService";
import { PanelApiService } from "../../services/PanelApiService";
import { gbToBytes } from "../../services/RemnawaveClient";
import { Subscription } from "../../types";
import { getShopItemById } from "./catalog";
import { formatSubscriptionUrlTelegramHtml } from "../subscriptionLinkHtml";

export interface PurchaseResult {
  success: boolean;
  details: string;
}

interface PurchaseOptions {
  targetSubscriptionId?: string;
  /** @username в Telegram (без @), если есть */
  telegramUsername?: string;
}

type PurchaseHandler = (
  userId: number,
  options?: PurchaseOptions
) => Promise<PurchaseResult>;

const SUBSCRIPTION_PERIOD_DAYS = 31;

const userService = new UserService();
const trafficService = new TrafficService();
const panelApi = new PanelApiService();

function formatSubscriptionSuccess(sub: Subscription): string {
  return (
    `📋 <b>Подписка активирована</b>\n` +
    `⏳ Период: <b>4 недели</b>\n` +
    `📅 До: <b>${new Date(sub.expiresAt).toLocaleDateString("ru-RU")}</b>\n\n` +
    `🔗 <b>Ссылка подписки</b>\n` +
    `<i>Нажмите, чтобы открыть; удерживайте ссылку — «Копировать».</i>\n\n` +
    `${formatSubscriptionUrlTelegramHtml(sub.subscriptionUrl)}`
  );
}

async function purchaseSubscriptionTier(
  userId: number,
  planId: string,
  initialTrafficGb: number,
  extra?: { telegramUsername?: string }
): Promise<PurchaseResult> {
  const item = getShopItemById(planId);

  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + SUBSCRIPTION_PERIOD_DAYS);

  const pendingId = await userService.createPendingSubscription(userId, planId, {
    pricePaid: item?.price ?? 0,
    trafficLimitBytes: initialTrafficGb > 0 ? gbToBytes(initialTrafficGb) : null,
    deviceLimit: item?.hwidDeviceLimit ?? null,
    endsAt,
  });
  if (pendingId === null) {
    return {
      success: false,
      details:
        "Не удалось создать запись подписки в БД. Выполните миграцию (DB_AUTO_MIGRATE=true или sql/schema_full.sql).",
    };
  }

  const panel = await panelApi.createClientForSubscriptionPeriod(
    userId,
    SUBSCRIPTION_PERIOD_DAYS,
    {
      initialTrafficGb,
      planId,
      telegramUsername: extra?.telegramUsername,
      subscriptionRowId: pendingId,
    }
  );
  if (!panel.ok) {
    await userService.cancelPendingSubscription(pendingId, userId);
    return { success: false, details: panel.error };
  }

  const inboundId = panelApi.getInboundId();
  if (inboundId === null) {
    await userService.cancelPendingSubscription(pendingId, userId);
    return { success: false, details: "На сервере не настроен PANEL_INBOUND_ID." };
  }

  // Remnawave: лимит уже в createClientForSubscriptionPeriod (trafficLimitBytes); addTrafficGb удвоил бы пакет.
  if (initialTrafficGb > 0 && !panelApi.usesRemnawavePanel()) {
    const added = await panelApi.addTrafficGb(
      inboundId,
      panel.clientId,
      panel.email,
      initialTrafficGb
    );
    if (!added.ok) {
      await userService.cancelPendingSubscription(pendingId, userId);
      return { success: false, details: added.error };
    }
  }

  const sub = await userService.finalizeSubscription(pendingId, userId, panel);
  if (!sub) {
    await userService.cancelPendingSubscription(pendingId, userId);
    return {
      success: false,
      details: "Панель ответила успешно, но не удалось зафиксировать подписку в БД.",
    };
  }

  return {
    success: true,
    details: formatSubscriptionSuccess(sub),
  };
}

const purchaseHandlers: Record<string, PurchaseHandler> = {
  subscription_compact: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_compact", 15),
  subscription_standard: async (userId, options) =>
    purchaseSubscriptionTier(userId, "subscription_standard", 0, {
      telegramUsername: options?.telegramUsername,
    }),
  subscription_premium: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_premium", 0),
  subscription_family: async (userId) =>
    purchaseSubscriptionTier(userId, "subscription_family", 0),
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
