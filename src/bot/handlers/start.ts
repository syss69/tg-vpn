import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { mainMenuKeyboard } from "../keyboards";

const userService = new UserService();

function buildMainMenuText(firstName: string): string {
  return (
    `👋 Рады вас видеть, <b>${firstName}</b>!\n\n` +
    `Мы предоставляем VLESS-конфигурации, специально разработанные для оптимизации маршрутов к устаревшему зарубежному оборудованию различных онлайн-платформ.\n\n` +
    `<b>Почему выбирают нас:</b>\n\n` +
    `1. <b>Высокая скорость:</b> Протокол VLESS обеспечивает минимальные задержки при передаче данных.\n` +
    `2. <b>Эффективная маршрутизация:</b> Оптимизируем доступ к устаревшим мощностям иностранных сервисов.\n` +
    `3. <b>Быстрый старт:</b> Настройка занимает всего пару минут и не требует специальных навыков.\n` +
    `4. <b>Безопасность, прозрачность и конфиденциальность:</b>\n\n` +
    `💳 Выберите тариф и начните пользоваться сервисом уже сегодня!\n\n` +
    `💬 Поддержка: \n\n` +
    `⚠️ <i>Сервис предоставляет инструменты для оптимизации маршрутизации трафика к устаревшему иностранному оборудованию. Сервис действует в полном соответствии с законодательством РФ. Пользователь самостоятельно несёт ответственность за способы использования предоставляемых конфигураций.</i>\n\n` +
    `<a href="https://telegra.ph/Pochemu-my-razdelyaem-prilozhenie-i-konfiguraciyu-vmesto-VPN-v-odnu-knopku-04-20">📖 Почему мы используем отдельное приложение?</a>\n` +
    `<a href="https://telegra.ph/Politika-konfidencialnosti-04-01-26">📖 Политика конфиденциальности</a>\n` +
    `<a href="https://telegra.ph/Polzovatelskoe-soglashenie-04-01-19">📖 Пользовательское соглашение</a>\n\n` +
    `Выберите действие:`
  );
}

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
    buildMainMenuText(firstName),
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
  const firstName = ctx.from?.first_name ?? "друг";
  await ctx.editMessageText(
    buildMainMenuText(firstName),
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard,
    }
  );
}
