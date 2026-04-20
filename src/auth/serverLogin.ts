import { captureCookiesFromResponse } from "./serverSession";

/**
 * POST /login на сервер панели.
 * Успешный ответ: куки сохраняются в serverSession (getCookieHeader / withSessionCookies).
 */
export async function loginToPanel(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const url = `${process.env.SERVER_URL}:${process.env.SERVER_PORT}/${process.env.SERVER_SUBDOMAIN}/login`;
  if (!process.env.SERVER_URL || !process.env.SERVER_PORT || !process.env.SERVER_SUBDOMAIN) {
    return {
      ok: false,
      error: "Не заданы SERVER_URL, SERVER_PORT и/или SERVER_SUBDOMAIN.",
    };
  }

  let body: unknown = {};
  const rawBody = process.env.LOGIN_BODY;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: "LOGIN_BODY должен быть валидным JSON." };
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const rawHeaders = process.env.LOGIN_HEADERS;
  if (rawHeaders) {
    try {
      Object.assign(headers, JSON.parse(rawHeaders));
    } catch {
      return { ok: false, error: "LOGIN_HEADERS должен быть валидным JSON-объектом." };
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Не удалось выполнить запрос логина: ${msg}` };
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => "");
    return {
      ok: false,
      error:
        `Логин на сервер не удался: ${res.status} ${res.statusText}` +
        (snippet ? `\n${snippet.slice(0, 500)}` : ""),
    };
  }

  captureCookiesFromResponse(res);
  await res.text().catch(() => {});
  return { ok: true };
}
