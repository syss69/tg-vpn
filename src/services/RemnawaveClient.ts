import { randomBytes } from "crypto";
import {
  clearPasswordLoginToken,
  ensureRemnawaveSession,
  getRemnawaveBearer,
  loginRemnawaveWithPassword,
  remnawaveBaseUrl,
  remnawaveProxyHeaders,
} from "../auth/remnawaveSession";

function staticApiTokenSet(): boolean {
  return Boolean(process.env.REMNAWAVE_API_TOKEN?.trim());
}

export type RemnawaveUserResponse = {
  uuid: string;
  username: string;
  email: string | null;
  subscriptionUrl: string;
  trafficLimitBytes: number;
  vlessUuid: string;
};

function mapUser(res: unknown): RemnawaveUserResponse | null {
  if (!res || typeof res !== "object") return null;
  const r = res as { response?: Record<string, unknown> };
  const u = r.response;
  if (!u || typeof u !== "object") return null;
  const uuid = u.uuid;
  const username = u.username;
  const subscriptionUrl = u.subscriptionUrl;
  const trafficLimitBytes = u.trafficLimitBytes;
  const vlessUuid = u.vlessUuid;
  const email = u.email;
  if (typeof uuid !== "string" || typeof username !== "string" || typeof subscriptionUrl !== "string") {
    return null;
  }
  return {
    uuid,
    username,
    email: typeof email === "string" ? email : null,
    subscriptionUrl,
    trafficLimitBytes: typeof trafficLimitBytes === "number" ? trafficLimitBytes : 0,
    vlessUuid: typeof vlessUuid === "string" ? vlessUuid : "",
  };
}

async function remnawaveFetchJson<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const base = remnawaveBaseUrl();
  if (!base) {
    return { ok: false, error: "REMNAWAVE_BASE_URL (или REMNAWAVE_PANEL_URL) не задан.", status: 0 };
  }

  const run = async (): Promise<Response> => {
    const session = await ensureRemnawaveSession();
    if (!session.ok) {
      throw new Error(session.error);
    }
    const bearer = getRemnawaveBearer();
    if (!bearer) {
      throw new Error("Нет Bearer-токена Remnawave.");
    }
    const headers: Record<string, string> = {
      ...remnawaveProxyHeaders(),
      Authorization: `Bearer ${bearer}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res: Response;
  try {
    res = await run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 0 };
  }

  if (res.status === 401 && !staticApiTokenSet()) {
    clearPasswordLoginToken();
    const relogin = await loginRemnawaveWithPassword();
    if (!relogin.ok) {
      return { ok: false, error: relogin.error, status: 401 };
    }
    try {
      res = await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, status: 0 };
    }
  }

  const data = (await res.json().catch(() => null)) as T | null;
  if (!res.ok) {
    const snippet =
      data && typeof data === "object" ? JSON.stringify(data).slice(0, 500) : await res.text().catch(() => "");
    return {
      ok: false,
      error: `Remnawave ${method} ${path}: ${res.status} ${snippet}`,
      status: res.status,
    };
  }
  return { ok: true, data: data as T };
}

export function parseActiveInternalSquads(): string[] {
  const raw = process.env.REMNAWAVE_ACTIVE_INTERNAL_SQUADS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function gbToBytes(gb: number): number {
  return Math.floor(gb * 1024 * 1024 * 1024);
}

export class RemnawaveClient {
  async getUserByUuid(uuid: string): Promise<
    { ok: true; user: RemnawaveUserResponse } | { ok: false; error: string }
  > {
    const path = `/api/users/${encodeURIComponent(uuid)}`;
    const result = await remnawaveFetchJson<unknown>("GET", path);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const user = mapUser(result.data);
    if (!user) {
      return { ok: false, error: "Не удалось разобрать ответ GET user." };
    }
    return { ok: true, user };
  }

  async createUser(params: {
    username: string;
    expireAtIso: string;
    telegramId: number;
    email?: string;
    trafficLimitBytes?: number;
    trafficLimitStrategy?: "NO_RESET" | "DAY" | "WEEK" | "MONTH";
    hwidDeviceLimit?: number;
    description?: string;
    /** Если задано — подставляется вместо REMNAWAVE_ACTIVE_INTERNAL_SQUADS */
    activeInternalSquads?: string[];
  }): Promise<{ ok: true; user: RemnawaveUserResponse } | { ok: false; error: string }> {
    const squads =
      params.activeInternalSquads !== undefined ? params.activeInternalSquads : parseActiveInternalSquads();
    const body: Record<string, unknown> = {
      username: params.username,
      status: "ACTIVE",
      expireAt: params.expireAtIso,
      telegramId: params.telegramId,
    };
    if (params.email) {
      body.email = params.email;
    }
    if (params.trafficLimitBytes !== undefined) {
      body.trafficLimitBytes = params.trafficLimitBytes;
    }
    if (params.trafficLimitStrategy) {
      body.trafficLimitStrategy = params.trafficLimitStrategy;
    }
    if (params.hwidDeviceLimit !== undefined) {
      body.hwidDeviceLimit = params.hwidDeviceLimit;
    }
    if (params.description !== undefined) {
      body.description = params.description;
    }
    if (squads.length > 0) {
      body.activeInternalSquads = squads;
    }

    const result = await remnawaveFetchJson<unknown>("POST", "/api/users/", body);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const user = mapUser(result.data);
    if (!user) {
      return { ok: false, error: "Не удалось разобрать ответ create user." };
    }
    return { ok: true, user };
  }

  async updateUserTrafficLimitBytes(
    uuid: string,
    trafficLimitBytes: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await remnawaveFetchJson<unknown>("PATCH", "/api/users/", {
      uuid,
      trafficLimitBytes,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true };
  }

  /** Уникальное имя пользователя в панели (3–36 символов). */
  static makeUsername(telegramUserId: number): string {
    const suffix = randomBytes(3).toString("hex");
    const base = `tg${telegramUserId}_${suffix}`;
    return base.length <= 36 ? base : base.slice(0, 36);
  }

  /**
   * Имя для подписки «Стандарт»: @username в Telegram (только [a-zA-Z0-9_-]) или `id{telegramId}_{8 hex}`.
   */
  static makeUsernameFromTelegram(telegramUserId: number, tgUsername?: string): string {
    if (tgUsername) {
      let s = tgUsername.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
      if (s.length < 3) {
        s = `id${telegramUserId}`;
      }
      return s.slice(0, 36);
    }
    const tail = randomBytes(4).toString("hex");
    return `id${telegramUserId}_${tail}`.slice(0, 36);
  }

  /**
   * Ищет UUID internal squad по имени (например Default-Squad). Ответ API может отличаться по версии — разбор максимально мягкий.
   */
  async findInternalSquadUuidByName(name: string): Promise<string | null> {
    const result = await remnawaveFetchJson<unknown>("GET", "/api/internal-squads/");
    if (!result.ok) {
      return null;
    }
    const needle = name.trim().toLowerCase();
    const candidates = collectObjectsWithUuidAndName(result.data);
    for (const c of candidates) {
      if (c.name && c.name.toLowerCase() === needle && c.uuid) {
        return c.uuid;
      }
    }
    return null;
  }
}

function collectObjectsWithUuidAndName(
  root: unknown
): Array<{ uuid: string; name: string }> {
  const out: Array<{ uuid: string; name: string }> = [];
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.uuid === "string" && typeof o.name === "string") {
      out.push({ uuid: o.uuid, name: o.name });
    }
    for (const val of Object.values(o)) {
      if (val && typeof val === "object") visit(val);
    }
  };
  visit(root);
  return out;
}
