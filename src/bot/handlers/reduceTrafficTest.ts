import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";

const userService = new UserService();

/**
 * Тестовая команда:
 * /reduce {key_number} {gb}
 * Пример: /reduce 1 3
 */
export async function handleReduceTrafficTest(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text;
  if (!userId || !rawText) return;

  const parts = rawText.trim().split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply(
      "Использование: /reduce {номер_ключа} {gb}\nПример: /reduce 1 3"
    );
    return;
  }

  const keyNumber = Number(parts[1]);
  const gb = Number(parts[2]);

  if (!Number.isInteger(keyNumber) || keyNumber <= 0) {
    await ctx.reply("Номер ключа должен быть положительным целым числом.");
    return;
  }

  if (!Number.isFinite(gb) || gb <= 0) {
    await ctx.reply("GB должно быть положительным числом.");
    return;
  }

  const result = await userService.reduceTrafficByKeyNumber(userId, keyNumber, gb);
  if (!result.success) {
    await ctx.reply(`❌ ${result.reason ?? "Не удалось списать трафик."}`);
    return;
  }

  await ctx.reply(
    `✅ Трафик списан\n` +
      `🔑 Ключ: <code>${result.keyValue}</code>\n` +
      `➖ Списано: <b>${gb} GB</b>\n` +
      `📊 Использовано: <b>${result.usedGb ?? 0} / ${result.totalGb ?? 0} GB</b>\n` +
      `📉 Остаток: <b>${result.remainingGb ?? 0} GB</b>`,
    { parse_mode: "HTML" }
  );
}
