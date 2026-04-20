/**
 * Активная подписка пользователя (период + доступ с панели).
 */
export interface Subscription {
  id: string;
  /** id позиции из каталога (например subscription_compact) */
  planId: string;
  /** Заголовок из каталога на момент покупки */
  planTitle: string;
  /** Внешний id клиента / токен подписки в панели */
  panelClientUuid: string;
  /** Email клиента в панели (если используется API) */
  panelEmail: string;
  /** Ссылка на подписку для импорта в клиент (например …/api/sub/{token}) */
  subscriptionUrl: string;
  /** Дата окончания периода (ISO) */
  expiresAt: string;
  /** Суммарный лимит трафика ускорения (GB); 0 = без отдельного лимита в учёте */
  totalTrafficGb: number;
  /** Израсходовано (GB) */
  usedTrafficGb: number;
  /** Дата покупки (ISO) */
  purchasedAt: string;
}

/**
 * Интерфейс пользователя в базе данных
 */
export interface User {
  /** Telegram ID пользователя */
  id: number;
  /** Username в Telegram (может отсутствовать) */
  username?: string;
  /** Имя из Telegram (кэш при первом /start) */
  firstName?: string;
  /** Код языка из Telegram (кэш при первом /start) */
  languageCode?: string;
  /** Баланс пользователя (в условных единицах) */
  balance: number;
  /** Подписки (JSON в колонке purchased_keys до переименования в БД) */
  subscriptions: Subscription[];
  /** Хранилище купленного трафика (для аудита) */
  trafficWalletGb?: number;
  /** Дата регистрации */
  createdAt: string;
}

/**
 * Состояние сессии пользователя в grammY
 */
export interface SessionData {
  /** Текущее действие пользователя (ожидание ввода суммы и т.д.) */
  awaitingTopUpAmount: boolean;
  /** Инвойс Crypto Pay, ожидающий оплаты/проверки */
  pendingTopUpInvoiceId?: number;
  /** Отложенная покупка, ожидающая подтверждения */
  pendingPurchase?: {
    itemId: string;
    /** Для докупки трафика — к какой подписке привязать */
    targetSubscriptionId?: string;
    /** Username Telegram на момент подтверждения покупки */
    telegramUsername?: string;
  };
}
