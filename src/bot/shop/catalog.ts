import {
  KEY_PLAN_1M_PRICE,
  KEY_PLAN_3M_PRICE,
  KEY_PLAN_12M_PRICE,
} from "../../services/KeyService";

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  price: number;
  buttonText: string;
}

/**
 * Каталог магазина.
 * Чтобы добавить новую позицию, достаточно расширить этот массив
 * и зарегистрировать обработчик покупки в purchaseHandlers.ts.
 */
export const SHOP_ITEMS: ShopItem[] = [
  {
    id: "api_key_1m",
    title: "API-ключ на 1 месяц",
    description: "Доступ к API на 1 месяц",
    price: KEY_PLAN_1M_PRICE,
    buttonText: "🔑 Ключ 1 месяц",
  },
  {
    id: "api_key_3m",
    title: "API-ключ на 3 месяца",
    description: "Доступ к API на 3 месяца",
    price: KEY_PLAN_3M_PRICE,
    buttonText: "🔑 Ключ 3 месяца",
  },
  {
    id: "api_key_12m",
    title: "API-ключ на 12 месяцев",
    description: "Доступ к API на 12 месяцев",
    price: KEY_PLAN_12M_PRICE,
    buttonText: "🔑 Ключ 12 месяцев",
  },
  {
    id: "white_list_10",
    title: "Белые списки 10 гб",
    description: "Трафик по белым спискам на 10 гб",
    price: 50,
    buttonText: "🔗 Купить 10 гб",
  },
  {
    id: "white_list_100",
    title: "Белые списки 100 гб",
    description: "Трафик по белым спискам на 100 гб",
    price: 250,
    buttonText: "🔗 Купить 100 гб",
  },
];

export function getShopItemById(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}
