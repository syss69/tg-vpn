/**
 * Один internal squad в Remnawave: UUID из .env и/или поиск по имени через API.
 * Цепочка как у бывшего «Стандарта»: сначала primary env, затем alternate (часто REMNAWAVE_BASE_*), затем имя.
 */
export interface RemnawaveInternalSquadBinding {
  /** Имя переменной с UUID (например REMNAWAVE_STANDARD_INTERNAL_SQUAD_UUID) */
  uuidEnvVar?: string;
  /** Если primary UUID пуст — взять UUID из этой переменной (например REMNAWAVE_BASE_INTERNAL_SQUAD_UUID) */
  alternateUuidEnvVar?: string;
  /** Имя переменной с именем сквада для поиска */
  nameEnvVar?: string;
  /** Если имя из nameEnvVar пусто — эта переменная */
  alternateNameEnvVar?: string;
  /** Имя для поиска по API, если из env не пришло */
  fallbackSquadName?: string;
}

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  price: number;
  buttonText: string;
  /** false = нет в наличии (кнопка покупки недоступна). По умолчанию true. */
  enabled?: boolean;
  /**
   * Лимит устройств (HWID) в Remnawave при оформлении подписки.
   * Только для позиций subscription_*; если не задан — в панели остаётся значение по умолчанию.
   */
  hwidDeviceLimit?: number;
  /**
   * Internal squads при создании пользователя (по порядку).
   * Если не задано — activeInternalSquads не передаётся (дефолт панели).
   */
  remnawaveInternalSquads?: RemnawaveInternalSquadBinding[];
  /**
   * Описание пользователя в панели; подставляется `{date}` датой оплаты (ru-RU).
   */
  remnawavePaidDescriptionTemplate?: string;
}

/** Товар доступен для покупки (есть в наличии). */
export function isShopItemEnabled(item: ShopItem): boolean {
  return item.enabled !== false;
}

/**
 * Каталог магазина.
 * Чтобы добавить новую позицию, достаточно расширить этот массив
 * и зарегистрировать обработчик покупки в purchaseHandlers.ts.
 */
export const SHOP_ITEMS: ShopItem[] = [
  {
    id: "subscription_compact",
    title: "Подписка Компакт на 4 недели",
    description:
      "Подписка Компакт даёт безлимитный доступ к 5 серверам в различных локациях, а также 15 GB трафика ускорения интернет-соединения для одного устройства",
    price: 79,
    buttonText: "💳 Оформить подписку Компакт",
    enabled: false,
    hwidDeviceLimit: 1,
    remnawavePaidDescriptionTemplate: "Подписка компакт оплачена {date}",
    /** Та же группа (internal squad), что у «Стандарта». */
    remnawaveInternalSquads: [
      {
        uuidEnvVar: "REMNAWAVE_STANDARD_INTERNAL_SQUAD_UUID",
        alternateUuidEnvVar: "REMNAWAVE_BASE_INTERNAL_SQUAD_UUID",
        nameEnvVar: "REMNAWAVE_STANDARD_INTERNAL_SQUAD_NAME",
        alternateNameEnvVar: "REMNAWAVE_BASE_INTERNAL_SQUAD_NAME",
        fallbackSquadName: "Default-Squad",
      },
    ],
  },
  {
    id: "subscription_standard",
    title: "Подписка Стандарт на 4 недели",
    description:
      "Подписка Стандарт даёт безлимитный доступ к 10 серверам в различных локациях, а также безлимитный трафик ускорения интернет-соединения для 2 устройств",
    price: 179,
    buttonText: "💳 Оформить подписку Стандарт",
    enabled: true,
    hwidDeviceLimit: 2,
    remnawavePaidDescriptionTemplate: "Подписка стандарт оплачена {date}",
    remnawaveInternalSquads: [
      {
        uuidEnvVar: "REMNAWAVE_STANDARD_INTERNAL_SQUAD_UUID",
        alternateUuidEnvVar: "REMNAWAVE_BASE_INTERNAL_SQUAD_UUID",
        nameEnvVar: "REMNAWAVE_STANDARD_INTERNAL_SQUAD_NAME",
        alternateNameEnvVar: "REMNAWAVE_BASE_INTERNAL_SQUAD_NAME",
        fallbackSquadName: "Default-Squad",
      },
    ],
  },
  {
    id: "subscription_premium",
    title: "Подписка Премиум на 4 недели",
    description:
      "Подписка Премиум даёт безлимитный доступ к 15 серверам в различных локациях, а также безлимитный трафик ускорения интернет-соединения для до 10 устройств",
    price: 399,
    buttonText: "💳 Оформить подписку Премиум",
    enabled: true,
    hwidDeviceLimit: 10,
    // Когда появятся отдельные сквады: remnawaveInternalSquads + REMNAWAVE_PREMIUM_* в .env
  },
  {
    id: "white_list_15",
    title: "Белые списки 15 гб",
    description: "Трафик для ускорения интернет-соединения на 15 гб",
    price: 50,
    buttonText: "🔗 Купить 15 гб",
    enabled: false,
  },
  {
    id: "white_list_100",
    title: "Белые списки 100 гб",
    description: "Трафик для ускорения интернет-соединения на 100 гб",
    price: 250,
    buttonText: "🔗 Купить 100 гб",
    enabled: false,
  },
];

export function getShopItemById(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}
