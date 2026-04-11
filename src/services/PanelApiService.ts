import { randomBytes, randomUUID } from "crypto";
import { loginToPanel } from "../auth/serverLogin";
import { withSessionCookies } from "../auth/serverSession";

/** Ответ API 3x-ui: `{ success, msg, obj }` с HTTP 200. */
interface PanelMsg<T = unknown> {
  success: boolean;
  msg?: string;
  obj?: T;
}

interface InboundApi {
  id: number;
  protocol: string;
  settings: string;
  /** Порт инбаунда (нужен для сборки share-link). */
  port?: number;
  /** streamSettings (в 3x-ui может быть JSON-строкой или уже объектом). */
  streamSettings?: unknown;
}

export class PanelApiService {
  private loginInFlight: Promise<{ ok: true } | { ok: false; error: string }> | null =
    null;

  private baseUrl(): string {
    const u = process.env.SERVER_URL;
    const p = process.env.SERVER_PORT;
    const s = process.env.SERVER_SUBDOMAIN;
    if (!u || !p || !s) {
      throw new Error("Задайте SERVER_URL, SERVER_PORT и SERVER_SUBDOMAIN.");
    }
    return `${u}:${p}/${s}`;
  }

  /** ID инбаунда из `PANEL_INBOUND_ID` (для покупки трафика и т.д.). */
  getInboundId(): number | null {
    const raw = process.env.PANEL_INBOUND_ID;
    if (raw === undefined || raw === "") return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  private async requestJson<T>(
    path: string,
    init?: RequestInit
  ): Promise<{ ok: true; data: PanelMsg<T> } | { ok: false; error: string }> {
    const ensureLoginOnce = async (): Promise<
      { ok: true } | { ok: false; error: string }
    > => {
      if (!this.loginInFlight) {
        this.loginInFlight = (async () => {
          try {
            return await loginToPanel();
          } finally {
            this.loginInFlight = null;
          }
        })();
      }
      return await this.loginInFlight;
    };

    const shouldReauthFromMsg = (msg?: string): boolean => {
      if (!msg) return false;
      const m = msg.toLowerCase();
      return (
        m.includes("unauthor") ||
        m.includes("forbidden") ||
        m.includes("not login") ||
        m.includes("login") ||
        m.includes("session") ||
        m.includes("cookie")
      );
    };

    const doFetch = async (): Promise<
      | { ok: true; res: Response; text: string; json: PanelMsg<T> }
      | { ok: false; error: string; res?: Response; text?: string; json?: PanelMsg<T> }
    > => {
      const method = (init?.method ?? "GET").toUpperCase();
      const extra: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
      };
      if (method !== "GET" && method !== "HEAD" && !extra["Content-Type"]) {
        extra["Content-Type"] = "application/json";
      }

      let res: Response;
      try {
        res = await fetch(`${this.baseUrl()}${path}`, {
          ...init,
          headers: withSessionCookies(extra),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `Сеть: ${msg}` };
      }

      const text = await res.text();
      let json: PanelMsg<T>;
      try {
        json = JSON.parse(text) as PanelMsg<T>;
      } catch {
        return {
          ok: false,
          error: `Панель не вернула JSON (${res.status}): ${text.slice(0, 200)}`,
          res,
          text,
        };
      }

      if (!res.ok || !json.success) {
        return { ok: false, error: json.msg || `HTTP ${res.status}`, res, text, json };
      }

      return { ok: true, res, text, json };
    };

    // Ленивая авторизация: логинимся, только если куки нет.
    if (!withSessionCookies()["Cookie"]) {
      const login = await ensureLoginOnce();
      if (!login.ok) return { ok: false, error: login.error };
    }

    // Первый запрос.
    const first = await doFetch();
    if (first.ok) return { ok: true, data: first.json };

    const status = first.res?.status;
    const needReauth =
      status === 401 || status === 403 || shouldReauthFromMsg(first.json?.msg);

    if (!needReauth) return { ok: false, error: first.error };

    // Пробуем перелогиниться и повторить один раз.
    const login = await ensureLoginOnce();
    if (!login.ok) return { ok: false, error: login.error };

    const second = await doFetch();
    if (second.ok) return { ok: true, data: second.json };
    return { ok: false, error: second.error };
  }

  async getInbound(id: number): Promise<InboundApi | null> {
    const r = await this.requestJson<InboundApi>(`/panel/api/inbounds/get/${id}`, {
      method: "GET",
    });
    if (!r.ok) return null;
    return r.data.obj ?? null;
  }

  private publicHost(): string | null {
    const raw = process.env.SERVER_URL;
    if (!raw) return null;
    try {
      return new URL(raw).hostname;
    } catch {
      // fallback для значений без протокола
      return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || null;
    }
  }

  private tryBuildVlessRealityUrl(args: {
    inbound: InboundApi;
    uuid: string;
    tag: string;
  }): string | null {
    const host = this.publicHost();
    const port = args.inbound.port;
    const stream = args.inbound.streamSettings;
    if (!host || !port || !stream) return null;

    const streamJson: any =
      typeof stream === "string"
        ? (() => {
            try {
              return JSON.parse(stream);
            } catch {
              return null;
            }
          })()
        : stream;
    if (!streamJson) return null;

    const network: string = String(streamJson.network ?? "tcp");
    const security: string = String(streamJson.security ?? "");
    if (security.toLowerCase() !== "reality") return null;

    const reality = streamJson.realitySettings ?? {};
    // В разных версиях 3x-ui поля realitySettings могут лежать либо на верхнем уровне,
    // либо внутри realitySettings.settings.
    const rs = reality.settings ?? reality;
    const pbk =
      reality.publicKey !== undefined
        ? String(reality.publicKey)
        : rs.publicKey !== undefined
          ? String(rs.publicKey)
          : "";
    const fp = rs.fingerprint !== undefined ? String(rs.fingerprint) : "";

    const serverNames = reality.serverNames ?? rs.serverNames;
    const sni =
      serverNames?.[0] !== undefined
        ? String(serverNames[0])
        : rs.serverName !== undefined
          ? String(rs.serverName)
          : "";

    const shortIds = reality.shortIds ?? rs.shortIds;
    const sid = shortIds?.[0] !== undefined ? String(shortIds[0]) : "";

    const spx = rs.spiderX !== undefined ? String(rs.spiderX) : "";

    if (!pbk) return null;

    // URL для кастомной схемы vless:// собираем вручную, чтобы корректно кодировать hash-часть.
    const params = new URLSearchParams();
    params.set("type", network);
    params.set("encryption", "none");
    params.set("security", "reality");
    params.set("pbk", pbk);
    if (fp) params.set("fp", fp);
    if (sni) params.set("sni", sni);
    if (sid) params.set("sid", sid);
    if (spx) params.set("spx", spx);

    return (
      `vless://${args.uuid}@${host}:${port}` +
      `?${params.toString()}` +
      `#${encodeURIComponent(args.tag)}`
    );
  }

  /**
   * Создаёт клиента на инбаунде. totalGB в теле API — байты (как в 3x-ui).
   */
  async createClientForPlan(
    telegramUserId: number,
    planMonths: number
  ): Promise<
    | { ok: true; clientId: string; email: string; displayValue: string; accessUrl?: string }
    | { ok: false; error: string }
  > {
    const inboundId = this.getInboundId();
    if (inboundId === null) {
      return { ok: false, error: "Не задан PANEL_INBOUND_ID в .env." };
    }

    const inbound = await this.getInbound(inboundId);
    if (!inbound) {
      return { ok: false, error: "Не удалось загрузить inbound с панели." };
    }

    const protocol = (inbound.protocol || "").toLowerCase();
    const email = `tg${telegramUserId}-${randomBytes(4).toString("hex")}@tg.bot`;
    const subId = randomBytes(8).toString("hex");
    // В 3x-ui expiryTime может быть отрицательным числом (длительность в мс).
    // 30 дней = 2_592_000_000 мс, 60 дней = 5_184_000_000 мс и т.д.
    const expiryMs = -Math.floor(planMonths * 30 * 24 * 60 * 60 * 1000);

    const base = {
      email,
      limitIp: 0,
      // В 3x-ui totalGB=0 обычно означает "безлимит".
      // Чтобы ключ создавался "с нулём трафика" до докупки, задаём минимальный лимит (1 байт).
      // Дальше докупка трафика увеличит лимит до нужного значения.
      totalGB: 1,
      expiryTime: expiryMs,
      enable: true,
      tgId: telegramUserId,
      subId,
      flow: "",
      reset: 0,
      comment: "",
    };

    let clientId: string;
    let displayValue: string;
    let clientObj: Record<string, unknown>;

    if (protocol === "trojan") {
      const password = randomBytes(16).toString("hex");
      clientId = password;
      displayValue = password;
      clientObj = { ...base, password };
    } else if (protocol === "shadowsocks") {
      clientId = email;
      displayValue = email;
      clientObj = {
        ...base,
        password: randomBytes(8).toString("base64url"),
      };
    } else {
      const uuid = randomUUID();
      clientId = uuid;
      displayValue = uuid;
      clientObj = {
        ...base,
        id: uuid,
        security: "auto",
      };
    }

    const settingsStr = JSON.stringify({
      clients: [clientObj],
    });

    const add = await this.requestJson(`/panel/api/inbounds/addClient`, {
      method: "POST",
      body: JSON.stringify({
        id: inboundId,
        settings: settingsStr,
      }),
    });

    if (!add.ok) {
      return { ok: false, error: add.error };
    }

    const tag = `For_White_List-${email}`;
    const accessUrl =
      protocol === "vless"
        ? this.tryBuildVlessRealityUrl({ inbound, uuid: clientId, tag })
        : null;

    return { ok: true, clientId, email, displayValue, accessUrl: accessUrl ?? undefined };
  }

  /**
   * Увеличивает лимит трафика клиента на панели (байты в поле totalGB).
   */
  async addTrafficGb(
    inboundId: number,
    clientId: string,
    email: string,
    addGb: number
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const inbound = await this.getInbound(inboundId);
    if (!inbound) {
      return { ok: false, error: "Не удалось загрузить inbound." };
    }

    let settings: { clients?: Record<string, unknown>[] };
    try {
      settings = JSON.parse(inbound.settings) as { clients?: Record<string, unknown>[] };
    } catch {
      return { ok: false, error: "Некорректный JSON settings у inbound." };
    }

    const clients = settings.clients ?? [];
    const idx = clients.findIndex((c) => {
      if (String(c.email) === email) return true;
      if (String(c.id) === clientId) return true;
      if (String(c.password) === clientId) return true;
      return false;
    });

    if (idx === -1) {
      return { ok: false, error: "Клиент не найден в inbound." };
    }

    const current = clients[idx];
    const oldBytes = Number(current.totalGB) || 0;
    const addBytes = Math.floor(addGb * 1024 * 1024 * 1024);
    const next = {
      ...current,
      totalGB: oldBytes + addBytes,
      updated_at: Date.now(),
    };

    const nextSettings = JSON.stringify({ clients: [next] });

    const upd = await this.requestJson(`/panel/api/inbounds/updateClient/${encodeURIComponent(clientId)}`, {
      method: "POST",
      body: JSON.stringify({
        id: inboundId,
        settings: nextSettings,
      }),
    });

    if (!upd.ok) {
      return { ok: false, error: upd.error };
    }

    return { ok: true };
  }
}
