import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { mainMenuKeyboard } from "../keyboards";

const userService = new UserService();

/**
 * Обработчик команды /start.
 * Регистрирует пользователя (если новый) и показывает главное меню.
 */
export async function handleStart(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;

  if (!userId) return;

  await userService.ensureUserOnBotStart({
    tgId: userId,
    username,
    firstName: ctx.from?.first_name,
    languageCode: ctx.from?.language_code,
  });

  const firstName = ctx.from?.first_name ?? "друг";

  await ctx.reply(
    `👋 Привет, <b>${firstName}</b>!\n\n` +
      `Добро пожаловать в магазин API-ключей.\n` +
      `Здесь вы можете приобрести ключи для доступа к нашему API.\n\n` +
      `Выберите действие:`,
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard,
    }
  );
}

/**
 * Обработчик callback «back_to_menu» — возврат в главное меню.
 */
export async function handleBackToMenu(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `🏠 <b>Главное меню</b>\n\nВыберите действие:`,
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard,
    }
  );
}
