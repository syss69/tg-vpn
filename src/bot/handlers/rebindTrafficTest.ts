import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";

const userService = new UserService();

/**
 * Тестовая команда:
 * /rebind {from_key_number} {to_key_number}
 * Пример: /rebind 1 2
 */
export async function handleRebindTrafficTest(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text;
  if (!userId || !rawText) return;

  const parts = rawText.trim().split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply(
      "Использование: /rebind {номер_сгоревшего_ключа} {номер_нового_ключа}\nПример: /rebind 1 2"
    );
    return;
  }

  const fromNumber = Number(parts[1]);
  const toNumber = Number(parts[2]);

  if (!Number.isInteger(fromNumber) || fromNumber <= 0) {
    await ctx.reply("Первый номер ключа должен быть положительным целым числом.");
    return;
  }
  if (!Number.isInteger(toNumber) || toNumber <= 0) {
    await ctx.reply("Второй номер ключа должен быть положительным целым числом.");
    return;
  }

  const result = userService.rebindRemainingTrafficByNumbers(userId, fromNumber, toNumber);
  if (!result.success) {
    await ctx.reply(`❌ ${result.reason ?? "Не удалось перепривязать трафик."}`);
    return;
  }

  await ctx.reply(
    `✅ Трафик перепривязан\n` +
      `📤 Со старого ключа: <code>${result.fromKey}</code>\n` +
      `📥 На новый ключ: <code>${result.toKey}</code>\n` +
      `🌐 Перенесено: <b>${result.movedGb ?? 0} GB</b>`,
    { parse_mode: "HTML" }
  );
}
