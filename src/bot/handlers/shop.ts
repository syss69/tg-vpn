import { BotContext } from "../bot";
import { UserService } from "../../services/UserService";
import { CryptoPayService } from "../../services/CryptoPayService";
import { CryptoPayInvoiceStore } from "../../services/CryptoPayInvoiceStore";
import {
  createShopKeyboard,
  createTrafficSubscriptionSelectionKeyboard,
  confirmPurchaseKeyboard,
  insufficientFundsKeyboard,
  afterActionKeyboard,
  backToMenuKeyboard,
} from "../keyboards";
import { getShopItemById, SHOP_ITEMS } from "../shop/catalog";
import { executePurchase } from "../shop/purchaseHandlers";
import { InlineKeyboard } from "grammy";

const userService = new UserService();
const cryptoPay = new CryptoPayService();
const invoiceStore = new CryptoPayInvoiceStore();

function getAssetAmountPrecision(asset: string): number {
  const a = asset.toUpperCase();
  if (a === "USDT" || a === "USDC" || a === "BUSD") return 2;
  if (a === "TON") return 4;
  if (a === "BTC" || a === "ETH") return 6;
  return 6;
}

function roundTo(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

async function convertRubToAssetAmount(params: {
  rubAmount: number;
  asset: string;
}): Promise<{ amountAsset: string; usedRateRubPerAsset?: number }> {
  const asset = params.asset.toUpperCase();

  // 1) Try live rate from Crypto Pay (best effort).
  try {
    const rates = await cryptoPay.getExchangeRates();

    const direct = rates.find(
      (r) => r.source?.toUpperCase() === asset && r.target?.toUpperCase() === "RUB"
    );
    if (direct?.rate) {
      const rubPerAsset = parseFloat(direct.rate);
      if (Number.isFinite(rubPerAsset) && rubPerAsset > 0) {
        const precision = getAssetAmountPrecision(asset);
        const amountAssetNum = roundTo(params.rubAmount / rubPerAsset, precision);
        return { amountAsset: amountAssetNum.toFixed(precision), usedRateRubPerAsset: rubPerAsset };
      }
    }

    const inverse = rates.find(
      (r) => r.source?.toUpperCase() === "RUB" && r.target?.toUpperCase() === asset
    );
    if (inverse?.rate) {
      const assetPerRub = parseFloat(inverse.rate);
      if (Number.isFinite(assetPerRub) && assetPerRub > 0) {
        const precision = getAssetAmountPrecision(asset);
        const amountAssetNum = roundTo(params.rubAmount * assetPerRub, precision);
        // Convert to rub-per-asset for display if possible
        const rubPerAsset = 1 / assetPerRub;
        return { amountAsset: amountAssetNum.toFixed(precision), usedRateRubPerAsset: rubPerAsset };
      }
    }
  } catch {
    // ignore and fallback to env rate below
  }

  // 2) Fallback rate from env: RUB per 1 ASSET (e.g. RUB per USDT)
  const fallbackRaw =
    process.env.CRYPTOPAY_RUB_PER_ASSET ??
    (asset === "USDT" ? process.env.CRYPTOPAY_RUB_PER_USDT : undefined);
  const fallback = fallbackRaw ? parseFloat(fallbackRaw) : NaN;
  if (!Number.isFinite(fallback) || fallback <= 0) {
    throw new Error(
      `Не удалось получить курс для ${asset}↔RUB. Задайте CRYPTOPAY_RUB_PER_ASSET (или CRYPTOPAY_RUB_PER_USDT) в .env.`
    );
  }

  const precision = getAssetAmountPrecision(asset);
  const amountAssetNum = roundTo(params.rubAmount / fallback, precision);
  return { amountAsset: amountAssetNum.toFixed(precision), usedRateRubPerAsset: fallback };
}

function parseApplyTrafficCallback(data: string): { itemId: string; subscriptionId: string } | null {
  const prefix = "apply_traffic:";
  if (!data.startsWith(prefix)) return null;

  const payload = data.slice(prefix.length);
  const delimiterIndex = payload.lastIndexOf(":");
  if (delimiterIndex === -1) return null;

  const itemId = payload.slice(0, delimiterIndex);
  const subscriptionId = payload.slice(delimiterIndex + 1);
  if (!itemId || !subscriptionId) return null;

  return { itemId, subscriptionId };
}

async function showPurchaseConfirmation(
  ctx: BotContext,
  itemId: string,
  targetSubscriptionId?: string
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const item = getShopItemById(itemId);
  if (!item) {
    await ctx.editMessageText("⚠️ Товар не найден.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const user = await userService.getOrCreate(userId, ctx.from?.username);
  const balance = user.balance;
  const deficit = Math.max(item.price - balance, 0);
  const subLine = targetSubscriptionId
    ? (() => {
        const s = user.subscriptions.find((x) => x.id === targetSubscriptionId);
        const label = s?.planTitle ?? "подписка";
        return `📋 Выбрана подписка: <b>${label}</b>\n`;
      })()
    : "";

  ctx.session.pendingPurchase = { itemId, targetSubscriptionId };

  await ctx.editMessageText(
    `🧾 <b>Подтверждение покупки</b>\n\n` +
      `🛍 Товар: <b>${item.title}</b>\n` +
      subLine +
      `💳 Стоимость: <b>${item.price} ед.</b>\n` +
      `💰 Ваш баланс: <b>${balance} ед.</b>\n` +
      `📉 Не хватает: <b>${deficit} ед.</b>\n\n` +
      `Вы уверены, что хотите купить этот товар?`,
    {
      parse_mode: "HTML",
      reply_markup: confirmPurchaseKeyboard,
    }
  );
}

async function executePendingPurchase(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const pending = ctx.session.pendingPurchase;
  if (!userId || !pending) return;

  const item = getShopItemById(pending.itemId);
  if (!item) {
    ctx.session.pendingPurchase = undefined;
    await ctx.editMessageText("⚠️ Товар не найден.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const user = await userService.getOrCreate(userId, ctx.from?.username);
  if (user.balance < item.price) {
    ctx.session.pendingPurchase = undefined;
    await ctx.editMessageText(
      `❌ <b>Недостаточно средств</b>\n\n` +
        `💰 Ваш баланс: <b>${user.balance} ед.</b>\n` +
        `💳 Стоимость товара: <b>${item.price} ед.</b>\n` +
        `📉 Не хватает: <b>${item.price - user.balance} ед.</b>\n\n` +
        `Пополните баланс, чтобы совершить покупку.`,
      {
        parse_mode: "HTML",
        reply_markup: insufficientFundsKeyboard,
      }
    );
    return;
  }

  if (pending.targetSubscriptionId) {
    const selected = user.subscriptions.find((s) => s.id === pending.targetSubscriptionId);
    if (!selected || userService.isSubscriptionExpired(selected)) {
      ctx.session.pendingPurchase = undefined;
      await ctx.editMessageText("⚠️ Выбранная подписка недоступна. Повторите покупку трафика.", {
        reply_markup: createShopKeyboard(),
      });
      return;
    }
  }

  const deducted = await userService.deductBalance(userId, item.price);
  if (!deducted) {
    ctx.session.pendingPurchase = undefined;
    await ctx.editMessageText("⚠️ Произошла ошибка при списании средств. Попробуйте снова.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const purchaseResult = await executePurchase(item.id, userId, {
    targetSubscriptionId: pending.targetSubscriptionId,
  });
  if (!purchaseResult.success) {
    await userService.topUpBalance(userId, item.price);
    ctx.session.pendingPurchase = undefined;
    await ctx.editMessageText(`⚠️ ${purchaseResult.details}\n\nСредства были возвращены на баланс.`, {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const updatedUser = await userService.findById(userId);
  let extraLine = "";
  if (pending.targetSubscriptionId) {
    const updatedSub = updatedUser?.subscriptions.find((s) => s.id === pending.targetSubscriptionId);
    const total = updatedSub?.totalTrafficGb ?? 0;
    const used = updatedSub?.usedTrafficGb ?? 0;
    const remaining = Math.max(total - used, 0);
    extraLine = `📊 Остаток трафика по подписке: <b>${remaining} GB</b>\n`;
  }

  ctx.session.pendingPurchase = undefined;
  await ctx.editMessageText(
    `✅ <b>Покупка успешна!</b>\n\n` +
      `🛍 Товар: <b>${item.title}</b>\n\n` +
      `${purchaseResult.details}\n\n` +
      `${extraLine}` +
      `💰 Остаток на балансе: <b>${updatedUser?.balance ?? 0} ед.</b>`,
    {
      parse_mode: "HTML",
      reply_markup: afterActionKeyboard,
    }
  );
}

/**
 * Обработчик кнопки «Магазин».
 * Показывает все доступные товары из каталога.
 */
export async function handleShop(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.pendingPurchase = undefined;

  const shopLines = SHOP_ITEMS.map(
    (item, index) =>
      `${index + 1}. <b>${item.title}</b>\n` +
      `   ${item.description}\n` +
      `   💳 Цена: <b>${item.price} ед.</b>`
  ).join("\n\n");

  await ctx.editMessageText(`🛒 <b>Магазин</b>\n\n${shopLines}\n\nВыберите товар:`, {
    parse_mode: "HTML",
    reply_markup: createShopKeyboard(),
  });
}

/**
 * Универсальный обработчик покупки товара из магазина.
 * Определяет позицию по callback-данным и выполняет покупку.
 */
export async function handleBuyItem(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  const callbackData = ctx.callbackQuery?.data;
  if (!callbackData?.startsWith("buy_item:")) {
    return;
  }

  const itemId = callbackData.replace("buy_item:", "");
  const item = getShopItemById(itemId);

  if (!item) {
    await ctx.editMessageText("⚠️ Этот товар не найден или уже недоступен.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const user = await userService.getOrCreate(userId, ctx.from?.username);

  const trafficMatch = item.id.match(/^white_list_(\d+)$/);
  if (trafficMatch) {
    const activeSubs = await userService.getActiveSubscriptions(userId);
    if (activeSubs.length === 0) {
      await ctx.editMessageText(
        `⚠️ Нет активных подписок для привязки трафика.\n\n` +
          `Оформите подписку, затем выберите пакет трафика.`,
        {
          reply_markup: createShopKeyboard(),
        }
      );
      return;
    }

    await ctx.editMessageText(
      `🔗 <b>Пакет трафика: ${trafficMatch[1]} GB</b>\n\n` +
        `Выберите подписку, к которой нужно привязать трафик:`,
      {
        parse_mode: "HTML",
        reply_markup: createTrafficSubscriptionSelectionKeyboard(item.id, activeSubs),
      }
    );
    return;
  }

  await showPurchaseConfirmation(ctx, item.id);
}

/**
 * Обработчик подтверждения покупки трафика для выбранной подписки.
 */
export async function handleApplyTrafficToSubscription(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  const callbackData = ctx.callbackQuery?.data;
  if (!callbackData) return;

  const parsed = parseApplyTrafficCallback(callbackData);
  if (!parsed) return;

  const item = getShopItemById(parsed.itemId);
  if (!item) {
    await ctx.editMessageText("⚠️ Товар не найден.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const user = await userService.getOrCreate(userId, ctx.from?.username);
  const selected = user.subscriptions.find((s) => s.id === parsed.subscriptionId);
  if (!selected) {
    await ctx.editMessageText("⚠️ Выбранная подписка не найдена.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }
  if (userService.isSubscriptionExpired(selected)) {
    await ctx.editMessageText("⚠️ Срок этой подписки истёк. Выберите активную подписку.", {
      reply_markup: createShopKeyboard(),
    });
    return;
  }

  await showPurchaseConfirmation(ctx, item.id, selected.id);
}

export async function handleConfirmPurchase(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await executePendingPurchase(ctx);
}

export async function handleCancelPurchase(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.pendingPurchase = undefined;
  await ctx.editMessageText("❌ Покупка отменена.", {
    reply_markup: createShopKeyboard(),
  });
}

/**
 * Обработчик кнопки «Пополнить баланс».
 * Запрашивает у пользователя сумму через сессию.
 */
export async function handleTopUp(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const userId = ctx.from?.id;
  if (!userId) return;

  // Устанавливаем флаг ожидания суммы в сессии
  ctx.session.awaitingTopUpAmount = true;

  await ctx.editMessageText(
    `💳 <b>Пополнение баланса</b>\n\n` +
      `Введите сумму, на которую хотите пополнить баланс (только число).\n\n` +
      `Например: <code>1000</code>`,
    {
      parse_mode: "HTML",
      reply_markup: backToMenuKeyboard,
    }
  );
}

/**
 * Обработчик текстовых сообщений — ловит ввод суммы пополнения.
 * Вызывается из основного bot.ts при awaitingTopUpAmount === true.
 */
export async function handleTopUpAmount(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !ctx.message?.text) return;

  const rawInput = ctx.message.text.trim();
  const amount = parseInt(rawInput, 10);

  // Валидация ввода
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply(
      `❌ Некорректная сумма.\nПожалуйста, введите целое положительное число (например: <code>500</code>).`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Сбрасываем флаг ожидания в сессии
  ctx.session.awaitingTopUpAmount = false;
  ctx.session.pendingTopUpInvoiceId = undefined;

  const asset = process.env.CRYPTOPAY_ASSET ?? "USDT";
  let amountAsset: string;
  let usedRateRubPerAsset: number | undefined;
  try {
    const converted = await convertRubToAssetAmount({ rubAmount: amount, asset });
    amountAsset = converted.amountAsset;
    usedRateRubPerAsset = converted.usedRateRubPerAsset;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.reply(`⚠️ Не удалось рассчитать сумму к оплате.\n\n${msg.slice(0, 300)}`, {
      reply_markup: afterActionKeyboard,
    });
    return;
  }

  let invoice;
  try {
    invoice = await cryptoPay.createInvoice({
      asset,
      amount: amountAsset,
      description: `Пополнение баланса на ${amount} ₽`,
      payload: JSON.stringify({ tgId: userId, amountUnits: amount }),
      expiresInSeconds: 60 * 60,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.reply(`⚠️ Не удалось создать счёт на оплату.\n\n${msg.slice(0, 300)}`, {
      reply_markup: afterActionKeyboard,
    });
    return;
  }

  await invoiceStore.ensureInvoice({
    invoiceId: invoice.invoice_id,
    tgId: userId,
    amountUnits: amount,
    asset,
    amountAsset,
    status: invoice.status ?? "unknown",
  });

  ctx.session.pendingTopUpInvoiceId = invoice.invoice_id;

  const payUrl = invoice.pay_url;
  const keyboard = new InlineKeyboard();
  if (payUrl) {
    keyboard.url("💳 Оплатить", payUrl).row();
  }
  keyboard.text("✅ Проверить оплату", `check_topup:${invoice.invoice_id}`).row();
  keyboard.text("⬅️ Главное меню", "back_to_menu");

  await ctx.reply(
    `🧾 <b>Счёт на оплату создан</b>\n\n` +
      `💳 Сумма пополнения: <b>${amount} ₽</b>\n` +
      `🪙 К оплате в Crypto Bot: <b>${amountAsset} ${asset}</b>\n\n` +
      (usedRateRubPerAsset
        ? `Курс: ~ <b>${usedRateRubPerAsset.toFixed(2)} ₽</b> за 1 ${asset}\n\n`
        : "") +
      `Нажмите «Оплатить», затем «Проверить оплату».`,
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );
}

export async function handleCheckTopUp(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  const data = ctx.callbackQuery?.data ?? "";
  const prefix = "check_topup:";
  if (!data.startsWith(prefix)) return;

  const invoiceId = parseInt(data.slice(prefix.length), 10);
  if (!invoiceId || Number.isNaN(invoiceId)) {
    await ctx.editMessageText("⚠️ Некорректный идентификатор счёта.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  let invoice;
  try {
    invoice = await cryptoPay.getInvoiceById(invoiceId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.editMessageText(`⚠️ Не удалось проверить оплату.\n\n${msg.slice(0, 300)}`, {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  if (!invoice) {
    await ctx.editMessageText("⚠️ Счёт не найден в Crypto Bot.", {
      reply_markup: backToMenuKeyboard,
    });
    return;
  }

  const status = invoice.status ?? "unknown";
  if (status === "paid") {
    await invoiceStore.markStatus({ invoiceId, status: "paid" });
    const credited = await invoiceStore.tryCreditInvoice({ invoiceId, tgId: userId });
    if (!credited.ok) {
      await ctx.editMessageText(`⚠️ Оплата найдена, но зачислить не удалось: ${credited.error}`, {
        reply_markup: backToMenuKeyboard,
      });
      return;
    }

    const updatedUser = await userService.findById(userId);
    const already = credited.alreadyCredited;
    await ctx.editMessageText(
      (already ? `✅ <b>Платёж уже был учтён</b>\n\n` : `✅ <b>Оплата подтверждена</b>\n\n`) +
        `💳 Зачислено: <b>+${credited.amountUnits} ед.</b>\n` +
        `💰 Баланс: <b>${updatedUser?.balance ?? "—"} ед.</b>`,
      {
        parse_mode: "HTML",
        reply_markup: afterActionKeyboard,
      }
    );
    return;
  }

  await invoiceStore.markStatus({
    invoiceId,
    status: status === "active" || status === "expired" ? status : "unknown",
  });

  const human =
    status === "active" ? "ожидает оплату" : status === "expired" ? "истёк" : "неизвестен";
  await ctx.editMessageText(
    `⏳ <b>Платёж пока не подтверждён</b>\n\n` +
      `Статус счёта: <b>${human}</b>\n\n` +
      `Если вы уже оплатили — подождите минуту и нажмите «Проверить оплату» ещё раз.`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("✅ Проверить оплату", `check_topup:${invoiceId}`)
        .row()
        .text("⬅️ Главное меню", "back_to_menu"),
    }
  );
}
