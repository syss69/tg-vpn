import { Bot, Context, session, SessionFlavor } from "grammy";
import { SessionData } from "../types";

// Импорт обработчиков
import { handleStart, handleBackToMenu } from "./handlers/start";
import { handleProfile } from "./handlers/profile";
import { handleDownloadApp } from "./handlers/downloadApp";
import {
  handleApplyTrafficToSubscription,
  handleBuyItem,
  handleCancelPurchase,
  handleConfirmPurchase,
  handleShop,
  handleTopUp,
  handleCheckTopUp,
  handleTopUpAmount,
} from "./handlers/shop";

/**
 * Тип контекста бота с поддержкой сессий.
 * Используется во всех обработчиках для типобезопасности.
 */
export type BotContext = Context & SessionFlavor<SessionData>;

/**
 * Создаёт и настраивает экземпляр бота grammY.
 * @param token - Токен Telegram бота
 * @returns Настроенный экземпляр Bot
 */
export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // --- Подключаем middleware сессий ---
  // Сессия хранится в памяти (встроенное хранилище grammY)
  bot.use(
    session({
      initial: (): SessionData => ({
        awaitingTopUpAmount: false,
        pendingPurchase: undefined,
      }),
    })
  );

  // --- Команды ---
  bot.command("start", handleStart);

  // --- Callback-кнопки ---
  bot.callbackQuery("profile", handleProfile);
  bot.callbackQuery("shop", handleShop);
  bot.callbackQuery(/^buy_item:/, handleBuyItem);
  bot.callbackQuery(/^apply_traffic:/, handleApplyTrafficToSubscription);
  bot.callbackQuery("confirm_purchase", handleConfirmPurchase);
  bot.callbackQuery("cancel_purchase", handleCancelPurchase);
  bot.callbackQuery("top_up", handleTopUp);
  bot.callbackQuery(/^check_topup:/, handleCheckTopUp);
  bot.callbackQuery("download_app", handleDownloadApp);
  bot.callbackQuery("back_to_menu", handleBackToMenu);

  // --- Обработка текстовых сообщений ---
  // Перехватываем текст только если пользователь находится в режиме ввода суммы
  bot.on("message:text", async (ctx) => {
    if (ctx.session.awaitingTopUpAmount) {
      await handleTopUpAmount(ctx);
    }
  });

  // --- Глобальный обработчик ошибок ---
  bot.catch((err) => {
    console.error("❌ Ошибка бота:", err.message);
    console.error(err.error);
  });

  return bot;
}
