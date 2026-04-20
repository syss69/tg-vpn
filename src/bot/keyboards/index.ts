import { InlineKeyboard } from "grammy";
import { Subscription } from "../../types";
import { SHOP_ITEMS } from "../shop/catalog";

/**
 * Главное меню бота — показывается при /start
 */
export const mainMenuKeyboard = new InlineKeyboard()
  .text("👤 Профиль", "profile")
  .text("🛒 Магазин", "shop")
  .row()
  .text("💳 Пополнить баланс", "top_up")
  .row()
  .text("📱 Скачать приложение", "download_app");

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
 * Клавиатура выбора подписки для привязки купленного трафика.
 */
export function createTrafficSubscriptionSelectionKeyboard(
  itemId: string,
  subscriptions: Subscription[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  subscriptions.forEach((sub, index) => {
    const shortTitle = sub.planTitle.slice(0, 22);
    keyboard.text(
      `📋 ${index + 1}: ${shortTitle}${sub.planTitle.length > 22 ? "…" : ""}`,
      `apply_traffic:${itemId}:${sub.id}`
    );
    if (index < subscriptions.length - 1) {
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
