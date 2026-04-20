/**
 * Сессия Remnawave: Bearer из API Token (предпочтительно) или accessToken после POST /api/auth/login.
 * Аналогично кукам 3x-ui: перед запросами вызывается ensureRemnawaveSession(), при 401 — повторный логин (если не статический токен).
 */

let passwordLoginAccessToken: string | null = null;

function staticApiToken(): string | null {
  const t = process.env.REMNAWAVE_API_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

export function remnawaveBaseUrl(): string | null {
  const raw = process.env.REMNAWAVE_BASE_URL?.trim() ?? process.env.REMNAWAVE_PANEL_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function remnawaveProxyHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (process.env.REMNAWAVE_FORWARDED_FOR) {
    h["x-forwarded-for"] = process.env.REMNAWAVE_FORWARDED_FOR;
  }
  if (process.env.REMNAWAVE_FORWARDED_PROTO) {
    h["x-forwarded-proto"] = process.env.REMNAWAVE_FORWARDED_PROTO;
  }
  const apiKey =
    process.env.REMNAWAVE_CADDY_API_KEY?.trim() ?? process.env.CADDY_AUTH_API_TOKEN?.trim();
  if (apiKey) {
    h["X-Api-Key"] = apiKey;
  }
  const extra = process.env.REMNAWAVE_EXTRA_HEADERS;
  if (extra) {
    try {
      Object.assign(h, JSON.parse(extra));
    } catch {
      /* ignore */
    }
  }
  return h;
}

export function getRemnawaveBearer(): string | null {
  return staticApiToken() ?? passwordLoginAccessToken;
}

export function clearPasswordLoginToken(): void {
  passwordLoginAccessToken = null;
}

export async function loginRemnawaveWithPassword(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const baseUrl = remnawaveBaseUrl();
  const username = process.env.REMNAWAVE_USERNAME?.trim();
  const password = process.env.REMNAWAVE_PASSWORD;
  if (!baseUrl || !username || password === undefined || password === "") {
    return {
      ok: false,
      error:
        "Для логина по паролю задайте REMNAWAVE_BASE_URL, REMNAWAVE_USERNAME и REMNAWAVE_PASSWORD.",
    };
  }

  const url = `${baseUrl}/api/auth/login`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...remnawaveProxyHeaders() },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Remnawave login: ${msg}` };
  }

  const data = (await res.json().catch(() => null)) as
    | { response?: { accessToken?: string }; message?: string }
    | null;
  if (!res.ok) {
    const snippet = data && typeof data === "object" ? JSON.stringify(data).slice(0, 400) : "";
    return {
      ok: false,
      error: `Remnawave login: ${res.status} ${res.statusText}${snippet ? `\n${snippet}` : ""}`,
    };
  }

  const token = data?.response?.accessToken;
  if (!token) {
    return { ok: false, error: "Remnawave login: в ответе нет response.accessToken." };
  }
  passwordLoginAccessToken = token;
  return { ok: true };
}

/**
 * Гарантирует наличие Bearer: либо REMNAWAVE_API_TOKEN, либо успешный логин по паролю.
 */
export async function ensureRemnawaveSession(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (staticApiToken()) {
    return { ok: true };
  }
  if (passwordLoginAccessToken) {
    return { ok: true };
  }
  return loginRemnawaveWithPassword();
}
