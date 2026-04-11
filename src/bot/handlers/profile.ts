import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { backToMenuKeyboard } from "../keyboards";

const userService = new UserService();

/**
 * Обработчик кнопки «Профиль».
 * Отображает Telegram ID, баланс и список купленных ключей.
 */
export async function handleProfile(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  // Получаем данные пользователя из сервисного слоя
  const user = userService.getOrCreate(userId, ctx.from?.username);

  // Формируем список ключей
  let keysSection: string;
  if (user.purchasedKeys.length === 0) {
    keysSection = "📭 У вас пока нет купленных ключей.";
  } else {
    const keyLines = user.purchasedKeys
      .map(
        (k, i) => {
          const total = k.totalTrafficGb ?? 0;
          const used = k.usedTrafficGb ?? 0;
          const remaining = Math.max(total - used, 0);
          const isExpired =
            k.expiresAt !== undefined && new Date(k.expiresAt).getTime() <= Date.now();
          const expiryLabel = k.expiresAt
            ? new Date(k.expiresAt).toLocaleDateString("ru-RU")
            : "без срока";
          const status = isExpired ? "сгорел" : "активен";
          const urlLine = k.accessUrl ? `\n      🔗 URL: <code>${k.accessUrl}</code>` : "";
          return (
            `  ${i + 1}. <code>${k.value}</code>\n` +
            (k.panelClientUuid ? `      🆔 UUID: <code>${k.panelClientUuid}</code>\n` : "") +
            `      ⏱ Статус: ${status}, до ${expiryLabel}\n` +
            `      📊 Трафик: ${remaining} GB из ${total} GB\n` +
            `      📅 ${new Date(k.purchasedAt).toLocaleDateString("ru-RU")}` +
            urlLine
          );
        }
      )
      .join("\n");
    keysSection = `🔑 <b>Ваши ключи (${user.purchasedKeys.length}):</b>\n${keyLines}`;
  }

  const profileText =
    `👤 <b>Ваш профиль</b>\n\n` +
    `🆔 ID: <code>${user.id}</code>\n` +
    `👤 Username: ${user.username ? `@${user.username}` : "не указан"}\n` +
    `💰 Баланс: <b>${user.balance} ед.</b>\n` +
    `🗂 Куплено трафика всего: <b>${user.trafficWalletGb ?? 0} GB</b>\n` +
    `📅 Дата регистрации: ${new Date(user.createdAt).toLocaleDateString("ru-RU")}\n\n` +
    keysSection;

  await ctx.editMessageText(profileText, {
    parse_mode: "HTML",
    reply_markup: backToMenuKeyboard,
  });
}
