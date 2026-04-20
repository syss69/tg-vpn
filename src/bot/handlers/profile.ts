import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { backToMenuKeyboard } from "../keyboards";
import { formatSubscriptionUrlTelegramHtml } from "../subscriptionLinkHtml";

const userService = new UserService();

function isUnlimitedAccelerationPlan(planId: string): boolean {
  return planId === "subscription_standard" || planId === "subscription_premium";
}

function formatTrafficLine(planId: string, total: number, used: number): string {
  const remaining = Math.max(total - used, 0);
  if (isUnlimitedAccelerationPlan(planId) && total === 0 && used === 0) {
    return `      📊 Ускорение: безлимит (по тарифу)`;
  }
  return `      📊 Ускорение: ${remaining} GB свободно из ${total} GB`;
}

/**
 * Обработчик кнопки «Профиль».
 * Отображает Telegram ID, баланс и подписки.
 */
export async function handleProfile(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await userService.getOrCreate(userId, ctx.from?.username);

  let subsSection: string;
  if (user.subscriptions.length === 0) {
    subsSection = "📭 У вас пока нет оформленных подписок.";
  } else {
    const lines = user.subscriptions
      .map((s, i) => {
        const isExpired = userService.isSubscriptionExpired(s);
        const expiryLabel = new Date(s.expiresAt).toLocaleDateString("ru-RU");
        const status = isExpired ? "истекла" : "активна";
        const legacy = s as { subscriptionUrl?: string; accessUrl?: string };
        const subUrl = legacy.subscriptionUrl ?? legacy.accessUrl;
        const urlLine = subUrl
          ? `\n      🔗 Подписка:\n      ${formatSubscriptionUrlTelegramHtml(subUrl)}`
          : "";
        return (
          `  ${i + 1}. <b>${s.planTitle}</b>\n` +
          `      🆔 Токен: <code>${s.panelClientUuid}</code>\n` +
          `      ⏱ Статус: ${status}, до ${expiryLabel}\n` +
          formatTrafficLine(s.planId, s.totalTrafficGb ?? 0, s.usedTrafficGb ?? 0) +
          `\n      📅 Оформлена: ${new Date(s.purchasedAt).toLocaleDateString("ru-RU")}` +
          urlLine
        );
      })
      .join("\n");
    subsSection = `📋 <b>Ваши подписки (${user.subscriptions.length}):</b>\n${lines}`;
  }

  const profileText =
    `👤 <b>Ваш профиль</b>\n\n` +
    `🆔 ID: <code>${user.id}</code>\n` +
    `👤 Username: ${user.username ? `@${user.username}` : "не указан"}\n` +
    `💰 Баланс: <b>${user.balance} ед.</b>\n` +
    `🗂 Куплено трафика всего: <b>${user.trafficWalletGb ?? 0} GB</b>\n` +
    `📅 Дата регистрации: ${new Date(user.createdAt).toLocaleDateString("ru-RU")}\n\n` +
    subsSection;

  await ctx.editMessageText(profileText, {
    parse_mode: "HTML",
    reply_markup: backToMenuKeyboard,
  });
}
