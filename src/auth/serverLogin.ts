import { captureCookiesFromResponse } from "./serverSession";

/**
 * POST /login на сервер при старте. При ответе не 2xx — процесс завершается с ошибкой.
 * Успешный ответ: куки сохраняются в serverSession (getCookieHeader / withSessionCookies).
 */
export async function ensureServerLogin(): Promise<void> {
  const url = `${process.env.SERVER_URL}:${process.env.SERVER_PORT}/${process.env.SERVER_SUBDOMAIN}/login`;
  if (!url) {
    console.error(
      "❌ Переменная окружения SERVER_URL, SERVER_PORT, SERVER_SUBDOMAIN не установлены!\n" 
    );
    process.exit(1);
  }

  let body: unknown = {};
  const rawBody = process.env.LOGIN_BODY;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error("❌ LOGIN_BODY должен быть валидным JSON.");
      process.exit(1);
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
      console.error("❌ LOGIN_HEADERS должен быть валидным JSON-объектом.");
      process.exit(1);
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
    console.error("❌ Не удалось выполнить запрос логина:", err);
    process.exit(1);
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => "");
    console.error(
      `❌ Логин на сервер не удался: ${res.status} ${res.statusText}` +
        (snippet ? `\n${snippet.slice(0, 500)}` : "")
    );
    process.exit(1);
  }

  captureCookiesFromResponse(res);
  await res.text().catch(() => {});
}
