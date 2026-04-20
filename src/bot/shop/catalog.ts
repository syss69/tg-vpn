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
    id: "subscription_compact",
    title: "Подписка Компакт на 4 недели",
    description:
      "Подписка Компакт даёт безлимитный доступ к 5 серверам в различных локациях, а также 15 GB трафика ускорения интернет-соединения для одного устройства",
    price: 79,
    buttonText: "💳 Оформить подписку Компакт",
  },
  {
    id: "subscription_standard",
    title: "Подписка Стандарт на 4 недели",
    description:
      "Подписка Стандарт даёт безлимитный доступ к 10 серверам в различных локациях, а также безлимитный трафик ускорения интернет-соединения для 2 устройств",
    price: 179,
    buttonText: "💳 Оформить подписку Стандарт",
  },
  {
    id: "subscription_premium",
    title: "Подписка Премиум на 4 недели",
    description:
      "Подписка Премиум даёт безлимитный доступ к 15 серверам в различных локациях, а также безлимитный трафик ускорения интернет-соединения для до 10 устройств",
    price: 399,
    buttonText: "💳 Оформить подписку Премиум",
  },
  {
    id: "white_list_15",
    title: "Белые списки 15 гб",
    description: "Трафик для ускорения интернет-соединения на 15 гб",
    price: 50,
    buttonText: "🔗 Купить 15 гб",
  },
  {
    id: "white_list_100",
    title: "Белые списки 100 гб",
    description: "Трафик для ускорения интернет-соединения на 100 гб",
    price: 250,
    buttonText: "🔗 Купить 100 гб",
  },
];

export function getShopItemById(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}
