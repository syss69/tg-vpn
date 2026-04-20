/**
 * Кликабельная ссылка для HTML в Telegram: удобно открыть тапом и скопировать (долгое нажатие → «Копировать ссылку»).
 * Сырой URL в &lt;code&gt; на телефоне часто неудобно выделять целиком.
 */
export function escapeHtmlAttrAndText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatSubscriptionUrlTelegramHtml(url: string): string {
  const e = escapeHtmlAttrAndText(url);
  return `<a href="${e}">${e}</a>`;
}
