/**
 * Интерфейс для API-ключа пользователя
 */
export interface ApiKey {
  /** Уникальный идентификатор ключа */
  id: string;
  /** Значение ключа */
  value: string;
  /** Идентификатор клиента в панели (UUID для VLESS/VMESS, пароль для Trojan и т.д.) */
  panelClientUuid?: string;
  /** Email клиента в панели */
  panelEmail?: string;
  /** Тариф ключа в месяцах (1, 3, 12) */
  planMonths?: number;
  /** Дата окончания срока действия ключа (ISO строка) */
  expiresAt?: string;
  /** Суммарно купленный трафик для ключа (GB) */
  totalTrafficGb?: number;
  /** Уже израсходованный трафик для ключа (GB) */
  usedTrafficGb?: number;
  /** Дата покупки (ISO строка) */
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
  /** Баланс пользователя (в условных единицах) */
  balance: number;
  /** Список купленных API-ключей */
  purchasedKeys: ApiKey[];
  /** Хранилище купленного трафика (для аудита/перепривязки) */
  trafficWalletGb?: number;
  /** Дата регистрации */
  createdAt: string;
}

/**
 * Структура локальной JSON-базы данных
 */
export interface Database {
  users: User[];
}

/**
 * Состояние сессии пользователя в grammY
 */
export interface SessionData {
  /** Текущее действие пользователя (ожидание ввода суммы и т.д.) */
  awaitingTopUpAmount: boolean;
  /** Отложенная покупка, ожидающая подтверждения */
  pendingPurchase?: {
    itemId: string;
    targetKeyId?: string;
  };
}
