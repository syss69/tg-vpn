import { UserService } from "../../services/UserService";
import { KeyService } from "../../services/KeyService";
import { TrafficService } from "../../services/TrafficService";
import { PanelApiService } from "../../services/PanelApiService";

export interface PurchaseResult {
  success: boolean;
  details: string;
}

interface PurchaseOptions {
  targetKeyId?: string;
}

type PurchaseHandler = (
  userId: number,
  options?: PurchaseOptions
) => Promise<PurchaseResult>;

const userService = new UserService();
const keyService = new KeyService();
const trafficService = new TrafficService();
const panelApi = new PanelApiService();

function formatKeySuccess(
  keyValue: string,
  panelClientUuid: string,
  planMonths: number,
  expiresAtIso: string,
  accessUrl?: string
): string {
  return (
    `🔑 Ваш новый ключ:\n<code>${keyValue}</code>\n` +
    `🆔 ID ключа (UUID):\n<code>${panelClientUuid}</code>\n` +
    `⏳ Срок: <b>${planMonths} мес.</b>\n` +
    `📅 Действует до: <b>${new Date(expiresAtIso).toLocaleDateString("ru-RU")}</b>` +
    (accessUrl ? `\n\n🔗 <b>Ссылка (VLESS)</b>:\n<code>${accessUrl}</code>` : "")
  );
}

const purchaseHandlers: Record<string, PurchaseHandler> = {
  api_key_1m: async (userId: number): Promise<PurchaseResult> => {
    const panel = await panelApi.createClientForPlan(userId, 1);
    if (!panel.ok) {
      return { success: false, details: panel.error };
    }
    const stub = keyService.generateKey(1);
    userService.addKeyToUser(userId, {
      ...stub,
      panelClientUuid: panel.clientId,
      panelEmail: panel.email,
      accessUrl: panel.accessUrl,
    });

    return {
      success: true,
      details: formatKeySuccess(
        stub.value,
        panel.clientId,
        1,
        stub.expiresAt ?? "",
        panel.accessUrl
      ),
    };
  },
  api_key_3m: async (userId: number): Promise<PurchaseResult> => {
    const panel = await panelApi.createClientForPlan(userId, 3);
    if (!panel.ok) {
      return { success: false, details: panel.error };
    }
    const stub = keyService.generateKey(3);
    userService.addKeyToUser(userId, {
      ...stub,
      panelClientUuid: panel.clientId,
      panelEmail: panel.email,
      accessUrl: panel.accessUrl,
    });

    return {
      success: true,
      details: formatKeySuccess(
        stub.value,
        panel.clientId,
        3,
        stub.expiresAt ?? "",
        panel.accessUrl
      ),
    };
  },
  api_key_12m: async (userId: number): Promise<PurchaseResult> => {
    const panel = await panelApi.createClientForPlan(userId, 12);
    if (!panel.ok) {
      return { success: false, details: panel.error };
    }
    const stub = keyService.generateKey(12);
    userService.addKeyToUser(userId, {
      ...stub,
      panelClientUuid: panel.clientId,
      panelEmail: panel.email,
      accessUrl: panel.accessUrl,
    });

    return {
      success: true,
      details: formatKeySuccess(
        stub.value,
        panel.clientId,
        12,
        stub.expiresAt ?? "",
        panel.accessUrl
      ),
    };
  },
};

export async function executePurchase(
  itemId: string,
  userId: number,
  options?: PurchaseOptions
): Promise<PurchaseResult> {
  const handler = purchaseHandlers[itemId];
  const trafficGb = trafficService.parseGbFromItemId(itemId);

  if (trafficGb !== null) {
    if (!options?.targetKeyId) {
      return {
        success: false,
        details: "Для покупки трафика нужно выбрать ключ.",
      };
    }

    const user = userService.findById(userId);
    const key = user?.purchasedKeys.find((k) => k.id === options.targetKeyId);
    if (!key) {
      return {
        success: false,
        details: "Выбранный ключ не найден.",
      };
    }
    if (!key.panelClientUuid || !key.panelEmail) {
      return {
        success: false,
        details:
          "Этот ключ создан до подключения панели. Купите новый ключ или обратитесь в поддержку.",
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
      key.panelClientUuid,
      key.panelEmail,
      trafficGb
    );
    if (!panel.ok) {
      return { success: false, details: panel.error };
    }

    const attached = userService.addTrafficToKey(userId, options.targetKeyId, trafficGb);
    if (!attached) {
      return {
        success: false,
        details: "Панель обновлена, но не удалось сохранить ключ в базе бота. Обратитесь в поддержку.",
      };
    }

    const trafficCode = trafficService.getTrafficCode(trafficGb);
    return {
      success: true,
      details:
        `🌐 Трафик <b>+${trafficGb} GB</b> привязан к выбранному ключу.\n🧩 Пакет: <code>${trafficCode}</code>`,
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
