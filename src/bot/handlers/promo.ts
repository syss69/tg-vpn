import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { PromoService } from "../../services/PromoService";
import { backToMenuKeyboard } from "../keyboards";

const userService = new UserService();
const promoService = new PromoService();

export async function handleEnterPromo(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const tgId = ctx.from?.id;
  if (!tgId) return;

  ctx.session.awaitingPromoCode = true;
  ctx.session.awaitingTopUpAmount = false;
  ctx.session.pendingPurchase = undefined;
  const msg = ctx.callbackQuery?.message;
  const chatId = ctx.chat?.id;
  if (chatId && msg && "message_id" in msg) {
    ctx.session.promoPrompt = {
      chatId,
      messageId: msg.message_id,
    };
  }

  await ctx.editMessageText(
    `🎟 <b>Промокод</b>\n\n` +
      `Отправьте промокод следующим сообщением.\n` +
      `Например: <code>PODAROK2026</code>`,
    { parse_mode: "HTML", reply_markup: backToMenuKeyboard }
  );
}

export async function handlePromoText(ctx: BotContext): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const text = ctx.message?.text?.trim();
  if (!text) return;

  // Пытаемся удалить сообщение пользователя с промокодом (чтобы не засорять чат).
  // В приватных чатах обычно ок; в группах может не быть прав — тогда просто игнорируем.
  try {
    await ctx.deleteMessage();
  } catch {
    // ignore
  }

  await userService.getOrCreate(tgId, ctx.from?.username);

  const res = await promoService.redeemPromoCode({
    tgId,
    rawCode: text,
    telegramUsername: ctx.from?.username,
  });

  // Если промокод не найден — остаёмся в режиме ввода и редактируем то же сообщение,
  // чтобы оно не улетало вверх.
  if (!res.ok && res.reason === "not_found") {
    ctx.session.awaitingPromoCode = true;
    const prompt = ctx.session.promoPrompt;
    const body =
      `❌ <b>Промокод не найден</b>\n\n` +
      `Попробуйте ещё раз — отправьте промокод следующим сообщением.\n` +
      `Например: <code>TRIAL3</code>`;

    if (prompt?.chatId && prompt.messageId) {
      await ctx.api.editMessageText(prompt.chatId, prompt.messageId, body, {
        parse_mode: "HTML",
        reply_markup: backToMenuKeyboard,
      });
      return;
    }

    await ctx.reply(body, { parse_mode: "HTML", reply_markup: backToMenuKeyboard });
    return;
  }

  // В остальных случаях (успех или другая ошибка) — выходим из режима ввода.
  const prompt = ctx.session.promoPrompt;
  ctx.session.awaitingPromoCode = false;
  ctx.session.promoPrompt = undefined;

  if (prompt?.chatId && prompt.messageId) {
    await ctx.api.editMessageText(prompt.chatId, prompt.messageId, res.message, {
      parse_mode: "HTML",
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  await ctx.reply(res.message, { parse_mode: "HTML" });
}

export async function handlePromo(ctx: BotContext): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/).filter(Boolean);
  const rawCode = parts.slice(1).join("");

  await userService.getOrCreate(tgId, ctx.from?.username);

  if (!rawCode) {
    await ctx.reply(
      `Введите промокод командой:\n` + `<code>/promo ABC123</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const res = await promoService.redeemPromoCode({
    tgId,
    rawCode,
    telegramUsername: ctx.from?.username,
  });

  await ctx.reply(res.message, { parse_mode: "HTML" });
}

