import { InlineKeyboard } from "grammy";
import { ApiKey } from "../../types";
import { SHOP_ITEMS } from "../shop/catalog";

/**
 * Главное меню бота — показывается при /start
 */
export const mainMenuKeyboard = new InlineKeyboard()
  .text("👤 Профиль", "profile")
  .text("🛒 Магазин", "shop")
  .row()
  .text("💳 Пополнить баланс", "top_up");

/**
 * Клавиатура для экрана «недостаточно средств»
 */
export const insufficientFundsKeyboard = new InlineKeyboard()
  .text("💳 Пополнить баланс", "top_up")
  .row()
  .text("⬅️ Назад", "back_to_menu");

/**
 * Кнопка возврата в главное меню
 */
export const backToMenuKeyboard = new InlineKeyboard().text(
  "⬅️ Главное меню",
  "back_to_menu"
);

/**
 * Клавиатура после успешной покупки / пополнения
 */
export const afterActionKeyboard = new InlineKeyboard()
  .text("👤 Профиль", "profile")
  .text("🛒 Купить ещё", "shop")
  .row()
  .text("⬅️ Главное меню", "back_to_menu");

/**
 * Клавиатура магазина на основе каталога товаров.
 */
export function createShopKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  SHOP_ITEMS.forEach((item, index) => {
    keyboard.text(item.buttonText, `buy_item:${item.id}`);
    if (index < SHOP_ITEMS.length - 1) {
      keyboard.row();
    }
  });

  keyboard.row().text("⬅️ Главное меню", "back_to_menu");
  return keyboard;
}

/**
 * Клавиатура выбора ключа для привязки купленного трафика.
 */
export function createTrafficKeySelectionKeyboard(itemId: string, keys: ApiKey[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keys.forEach((key, index) => {
    const shortValue = key.value.slice(0, 18);
    keyboard.text(`🔑 ${index + 1}: ${shortValue}...`, `apply_traffic:${itemId}:${key.id}`);
    if (index < keys.length - 1) {
      keyboard.row();
    }
  });

  keyboard.row().text("⬅️ В магазин", "shop");
  return keyboard;
}

/**
 * Клавиатура подтверждения покупки.
 */
export const confirmPurchaseKeyboard = new InlineKeyboard()
  .text("✅ Подтвердить", "confirm_purchase")
  .text("❌ Отмена", "cancel_purchase");
