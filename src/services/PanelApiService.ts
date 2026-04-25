import { randomBytes } from "crypto";
import {
  getShopItemById,
  type RemnawaveInternalSquadBinding,
} from "../bot/shop/catalog";
import { RemnawaveClient, gbToBytes } from "./RemnawaveClient";
import { SubscriptionService } from "./SubscriptionService";

function useRemnawave(): boolean {
  return Boolean(
    process.env.REMNAWAVE_BASE_URL?.trim() || process.env.REMNAWAVE_PANEL_URL?.trim()
  );
}

function trafficStrategy(): "NO_RESET" | "DAY" | "WEEK" | "MONTH" {
  const s = process.env.REMNAWAVE_TRAFFIC_LIMIT_STRATEGY?.trim().toUpperCase();
  if (s === "DAY" || s === "WEEK" || s === "MONTH" || s === "NO_RESET") {
    return s;
  }
  return "NO_RESET";
}

/**
 * Синтетический email для панели только если задан нормальный домен в REMNAWAVE_USER_EMAIL_DOMAIN.
 * Раньше пустая строка в .env давала `u…@` без домена → 400 Invalid email format.
 */
function buildOptionalSyntheticEmail(telegramUserId: number): string | undefined {
  const raw = process.env.REMNAWAVE_USER_EMAIL_DOMAIN;
  if (raw === undefined) return undefined;
  const domain = raw.trim().replace(/^@/, "");
  if (!domain) return undefined;
  const local = `u${telegramUserId}-${randomBytes(3).toString("hex")}`;
  const full = `${local}@${domain}`;
  // Remnawave валидирует как email; нужен хотя бы один разделитель в домене (user@a.b)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(full)) {
    return undefined;
  }
  return full;
}

/**
 * Интеграция с панелью: Remnawave (REST API + Bearer), если задан REMNAWAVE_BASE_URL.
 * Иначе — локальная заглушка без сети (для разработки без панели).
 */
export class PanelApiService {
  private readonly remnawave = new RemnawaveClient();

  /**
   * Для 3x-ui это был id инбаунда; у Remnawave не используется — возвращаем 1, чтобы не ломать проверки в purchaseHandlers.
   */
  /** Пользователи создаются через Remnawave API (лимит трафика задаётся при createUser). */
  usesRemnawavePanel(): boolean {
    return useRemnawave();
  }

  getInboundId(): number | null {
    if (useRemnawave()) {
      return 1;
    }
    const raw = process.env.PANEL_INBOUND_ID;
    if (raw === undefined || raw === "") return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Создаёт пользователя в Remnawave и возвращает ссылку подписки из ответа API.
   */
  /**
   * @param options.subscriptionRowId — id строки в БД (subscriptions.id); добавляется к username как `_s{id}` для уникальности.
   */
  async createClientForSubscriptionPeriod(
    telegramUserId: number,
    durationDays: number,
    options?: {
      initialTrafficGb?: number;
      planId?: string;
      telegramUsername?: string;
      subscriptionRowId?: number;
    }
  ): Promise<
    | { ok: true; clientId: string; email: string; subscriptionUrl: string }
    | { ok: false; error: string }
  > {
    if (!useRemnawave()) {
      return this.createClientStub(telegramUserId);
    }

    const planId = options?.planId;
    const isStandard = planId === "subscription_standard";
    const catalogItem = planId ? getShopItemById(planId) : undefined;

    const exp = new Date();
    exp.setDate(exp.getDate() + durationDays);
    const expireAtIso = exp.toISOString();
    const initialGb = options?.initialTrafficGb ?? 0;

    const paidDate = new Date().toLocaleDateString("ru-RU");

    const username =
      options?.subscriptionRowId !== undefined
        ? this.buildPanelUsername(
            planId,
            telegramUserId,
            options.telegramUsername,
            options.subscriptionRowId
          )
        : isStandard
          ? RemnawaveClient.makeUsernameFromTelegram(telegramUserId, options?.telegramUsername)
          : RemnawaveClient.makeUsername(telegramUserId);

    const email = buildOptionalSyntheticEmail(telegramUserId);

    const createParams: Parameters<RemnawaveClient["createUser"]>[0] = {
      username,
      expireAtIso,
      telegramId: telegramUserId,
      trafficLimitStrategy: trafficStrategy(),
    };
    if (email) {
      createParams.email = email;
    }
    if (initialGb > 0) {
      createParams.trafficLimitBytes = gbToBytes(initialGb);
    }

    if (catalogItem?.hwidDeviceLimit !== undefined) {
      createParams.hwidDeviceLimit = catalogItem.hwidDeviceLimit;
    }

    const descTpl = catalogItem?.remnawavePaidDescriptionTemplate?.trim();
    if (descTpl) {
      createParams.description = descTpl.replace(/\{date\}/g, paidDate);
    }

    const squadBindings = catalogItem?.remnawaveInternalSquads;
    if (squadBindings?.length) {
      const squads = await this.resolveInternalSquads(squadBindings);
      if (!squads.ok) {
        return { ok: false, error: squads.error };
      }
      createParams.activeInternalSquads = squads.uuids;
    }

    const created = await this.remnawave.createUser(createParams);
    if (!created.ok) {
      return { ok: false, error: created.error };
    }

    return {
      ok: true,
      clientId: created.user.uuid,
      email: created.user.email ?? `u${telegramUserId}@remnawave.bot`,
      subscriptionUrl: created.user.subscriptionUrl,
    };
  }

  /** Уникальный username в панели: суффикс `_s{subscriptionRowId}` привязан к строке в БД. */
  private buildPanelUsername(
    planId: string | undefined,
    telegramUserId: number,
    telegramUsername: string | undefined,
    subscriptionRowId: number
  ): string {
    const suf = `_s${subscriptionRowId}`;
    if (planId === "subscription_standard") {
      if (telegramUsername) {
        let s = telegramUsername.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
        if (s.length < 3) {
          s = `id${telegramUserId}`;
        }
        return `${s}${suf}`.slice(0, 36);
      }
      return `id${telegramUserId}${suf}`.slice(0, 36);
    }
    return `tg${telegramUserId}${suf}`.slice(0, 36);
  }

  private squadUuidFromBinding(b: RemnawaveInternalSquadBinding): string | undefined {
    const primary = b.uuidEnvVar ? process.env[b.uuidEnvVar]?.trim() : undefined;
    if (primary) return primary;
    const alt = b.alternateUuidEnvVar ? process.env[b.alternateUuidEnvVar]?.trim() : undefined;
    if (alt) return alt;
    return undefined;
  }

  private squadNameFromBinding(b: RemnawaveInternalSquadBinding): string | undefined {
    const n1 = b.nameEnvVar ? process.env[b.nameEnvVar]?.trim() : undefined;
    if (n1) return n1;
    const n2 = b.alternateNameEnvVar ? process.env[b.alternateNameEnvVar]?.trim() : undefined;
    if (n2) return n2;
    const fb = b.fallbackSquadName?.trim();
    if (fb) return fb;
    return undefined;
  }

  private async resolveInternalSquads(
    bindings: RemnawaveInternalSquadBinding[]
  ): Promise<{ ok: true; uuids: string[] } | { ok: false; error: string }> {
    const uuids: string[] = [];
    for (const b of bindings) {
      const fromEnv = this.squadUuidFromBinding(b);
      if (fromEnv) {
        uuids.push(fromEnv);
        continue;
      }
      const name = this.squadNameFromBinding(b);
      if (!name) {
        return {
          ok: false,
          error:
            "Для подписки не задан internal squad: укажите UUID в .env (uuidEnvVar / alternateUuidEnvVar) или имя сквада (nameEnvVar / fallbackSquadName).",
        };
      }
      const uuid = await this.remnawave.findInternalSquadUuidByName(name);
      if (!uuid) {
        return {
          ok: false,
          error:
            `Не найден internal squad «${name}». Задайте UUID сквада в .env или проверьте имя в панели Remnawave.`,
        };
      }
      uuids.push(uuid);
    }
    return { ok: true, uuids };
  }

  private createClientStub(
    telegramUserId: number
  ): Promise<
    { ok: true; clientId: string; email: string; subscriptionUrl: string } | { ok: false; error: string }
  > {
    const subscriptionService = new SubscriptionService();
    const { subscriptionUrl, token } = subscriptionService.generateSubscriptionLink();
    const email = `stub-${telegramUserId}-${randomBytes(4).toString("hex")}@remnawave.placeholder`;
    return Promise.resolve({
      ok: true,
      clientId: token,
      email,
      subscriptionUrl,
    });
  }

  /**
   * Увеличивает лимит трафика пользователя (bytes) в Remnawave.
   */
  async addTrafficGb(
    _inboundId: number,
    clientId: string,
    _email: string,
    addGb: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!useRemnawave()) {
      return { ok: true };
    }

    const current = await this.remnawave.getUserByUuid(clientId);
    if (!current.ok) {
      return { ok: false, error: current.error };
    }
    const addBytes = gbToBytes(addGb);
    const prev = current.user.trafficLimitBytes ?? 0;
    const next = prev + addBytes;
    const updated = await this.remnawave.updateUserTrafficLimitBytes(clientId, next);
    if (!updated.ok) {
      return { ok: false, error: updated.error };
    }
    return { ok: true };
  }
}
