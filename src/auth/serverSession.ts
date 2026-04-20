/**
 * Сессия с панелью (3x-ui и т.п.): куки из ответа POST /login для последующих запросов.
 */

let cookieHeader: string | null = null;

function parseSetCookieLines(res: Response): string[] {
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** Берёт из каждой строки Set-Cookie только пару name=value (до первого `;`). */
function setCookieLinesToCookieHeader(lines: string[]): string {
  return lines
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

/** Вызывать после успешного логина: сохраняет куки из заголовков ответа. */
export function captureCookiesFromResponse(res: Response): void {
  const lines = parseSetCookieLines(res);
  cookieHeader = lines.length ? setCookieLinesToCookieHeader(lines) : null;
}

/** Строка для заголовка `Cookie` в fetch, или `null`, если логин ещё не сохранил куки. */
export function getCookieHeader(): string | null {
  return cookieHeader;
}

export function hasSessionCookies(): boolean {
  return Boolean(cookieHeader);
}

/** Удобно передать в `headers` при fetch к защищённым эндпоинтам. */
export function withSessionCookies(
  base: Record<string, string> = {}
): Record<string, string> {
  const c = cookieHeader;
  if (!c) return { ...base };
  return { ...base, Cookie: c };
}
