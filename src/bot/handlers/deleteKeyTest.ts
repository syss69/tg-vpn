import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";

const userService = new UserService();

/**
 * Тестовая команда:
 * /deletekey {key_number}
 * Пример: /deletekey 2
 */
export async function handleDeleteKeyTest(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const rawText = ctx.message?.text;
  if (!userId || !rawText) return;

  const parts = rawText.trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Использование: /deletekey {номер_ключа}\nПример: /deletekey 2");
    return;
  }

  const keyNumber = Number(parts[1]);
  if (!Number.isInteger(keyNumber) || keyNumber <= 0) {
    await ctx.reply("Номер ключа должен быть положительным целым числом.");
    return;
  }

  const result = userService.deleteKeyByNumber(userId, keyNumber);
  if (!result.success) {
    await ctx.reply(`❌ ${result.reason ?? "Не удалось удалить ключ."}`);
    return;
  }

  await ctx.reply(
    `🗑 Ключ удален\n` +
      `🔑 Ключ: <code>${result.keyValue}</code>\n` +
      `⏱ Статус: <b>${result.wasExpired ? "сгоревший" : "активный"}</b>\n` +
      `📊 Остаток на удаленном ключе: <b>${result.remainingTrafficGb ?? 0} GB</b>`,
    { parse_mode: "HTML" }
  );
}
