import express, { Express } from "express";
import { Server } from "http";
import { getPool } from "../db/pool";
import { SubscriptionTokensRepository } from "../repositories/subscriptionTokens.repository";
import { HappCryptoService } from "../services/HappCryptoService";
import { SubscriptionProxyService } from "../services/SubscriptionProxyService";
import { UserService } from "../services/UserService";

export interface StartedWebServer {
  app: Express;
  server: Server;
  port: number;
  close: () => Promise<void>;
}

function resolvePort(): number {
  const rawPort = process.env.PORT?.trim();
  const parsed = rawPort ? Number.parseInt(rawPort, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendHtml(res: express.Response, statusCode: number, html: string): void {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(statusCode).send(html);
}

function renderSimplePage(params: { title: string; message: string }): string {
  const title = escapeHtml(params.title);
  const message = escapeHtml(params.message);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; color: #111827; }
    main { max-width: 640px; margin: 48px auto; padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0; color: #374151; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;
}

function renderInstallPage(params: {
  planTitle: string;
  statusText: string;
  expiresAtText: string;
  proxyPath: string;
  proxyUrl: string;
}): string {
  const planTitle = escapeHtml(params.planTitle);
  const statusText = escapeHtml(params.statusText);
  const expiresAtText = escapeHtml(params.expiresAtText);
  const proxyPath = escapeHtml(params.proxyPath);
  const proxyUrl = escapeHtml(params.proxyUrl);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ключ для установки</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; color: #111827; }
    main { max-width: 720px; margin: 32px auto; padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { color: #4b5563; margin-bottom: 18px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 18px; }
    .btn { display: inline-block; text-decoration: none; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 14px; font-size: 14px; cursor: pointer; background: #fff; color: #111827; }
    .btn.primary { background: #111827; border-color: #111827; color: #fff; }
    code { display: block; padding: 10px 12px; background: #f3f4f6; border-radius: 8px; overflow-wrap: anywhere; }
    ol { margin: 10px 0 0 20px; color: #374151; }
    li { margin: 6px 0; }
    .hint { margin-top: 10px; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>🔑 ${planTitle}</h1>
    <div class="meta">Статус: ${statusText} · Действует до: ${expiresAtText}</div>

    <div class="actions">
      <a class="btn primary" href="${proxyPath}">Открыть подписку</a>
      <button class="btn" type="button" id="copy-btn">Скопировать ссылку</button>
    </div>

    <code id="proxy-url">${proxyUrl}</code>

    <h2>Как установить в Happ</h2>
    <ol>
      <li>Откройте Happ на устройстве.</li>
      <li>Нажмите «Открыть подписку» или скопируйте ссылку и вставьте её в импорт подписки.</li>
      <li>Подтвердите импорт и включите подключение.</li>
    </ol>
    <div class="hint">Используется безопасный proxy URL, без прямой выдачи внутреннего URL панели.</div>
  </main>

  <script>
    (function () {
      var btn = document.getElementById("copy-btn");
      var urlEl = document.getElementById("proxy-url");
      if (!btn || !urlEl) return;
      btn.addEventListener("click", function () {
        var text = urlEl.textContent || "";
        if (!text) return;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Ссылка скопирована";
          setTimeout(function () { btn.textContent = "Скопировать ссылку"; }, 1500);
        }).catch(function () {
          btn.textContent = "Не удалось скопировать";
          setTimeout(function () { btn.textContent = "Скопировать ссылку"; }, 1500);
        });
      });
    })();
  </script>
</body>
</html>`;
}

export async function startWebServer(): Promise<StartedWebServer> {
  const app = express();
  const port = resolvePort();
  const userService = new UserService();
  const happCryptoService = new HappCryptoService();
  const subscriptionTokensRepository = new SubscriptionTokensRepository(getPool());
  const subscriptionProxyService = new SubscriptionProxyService(subscriptionTokensRepository);
  app.set("trust proxy", true);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/proxy-sub/:token", async (req, res) => {
    try {
      const token = req.params.token ?? "";

      if (!token) {
        res.status(400).send("Token is required");
        return;
      }

      const xForwardedFor = req.headers["x-forwarded-for"];
      const ip =
        typeof xForwardedFor === "string"
          ? xForwardedFor.split(",")[0]?.trim() ?? null
          : (req.socket.remoteAddress ?? null);
      const userAgent =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;

      if (process.env.NODE_ENV !== "production") {
        console.log("[proxy-sub] request headers:", {
          userAgent: req.headers["user-agent"],
          accept: req.headers["accept"],
          acceptEncoding: req.headers["accept-encoding"],
          acceptLanguage: req.headers["accept-language"],
          connection: req.headers["connection"],
          xHwid: req.headers["x-hwid"],
          xDeviceOs: req.headers["x-device-os"],
          xVerOs: req.headers["x-ver-os"],
          xDeviceModel: req.headers["x-device-model"],
          host: req.headers["host"],
        });
      }

      const result = await subscriptionProxyService.getSubscriptionContent({
        token,
        ip,
        userAgent,
        clientHeaders: {
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          accept: typeof req.headers["accept"] === "string" ? req.headers["accept"] : null,
          acceptEncoding: typeof req.headers["accept-encoding"] === "string" ? req.headers["accept-encoding"] : null,
          acceptLanguage: typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : null,
          connection: typeof req.headers["connection"] === "string" ? req.headers["connection"] : null,
          xHwid: typeof req.headers["x-hwid"] === "string" ? req.headers["x-hwid"] : null,
          xDeviceOs: typeof req.headers["x-device-os"] === "string" ? req.headers["x-device-os"] : null,
          xVerOs: typeof req.headers["x-ver-os"] === "string" ? req.headers["x-ver-os"] : null,
          xDeviceModel: typeof req.headers["x-device-model"] === "string" ? req.headers["x-device-model"] : null,
        },
      });

      if (result.ok === false) {
        res.status(result.status).send(result.message);
        return;
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment; filename=sub.txt");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");

      res.status(200).send(result.body);
    } catch (error) {
      console.error("[GET /proxy-sub/:token] error:", error);
      res.status(500).send("Internal server error");
    }
  });

  app.get("/sub/:token", async (req, res) => {
    try {
      const token = req.params.token ?? "";

      if (!token) {
        res.status(400).send("Token is required");
        return;
      }

      const xForwardedFor = req.headers["x-forwarded-for"];
      const ip =
        typeof xForwardedFor === "string"
          ? xForwardedFor.split(",")[0]?.trim() ?? null
          : (req.socket.remoteAddress ?? null);
      const userAgent =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;

      const result = await subscriptionProxyService.getSubscriptionContent({
        token,
        ip,
        userAgent,
        clientHeaders: {
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          accept: typeof req.headers["accept"] === "string" ? req.headers["accept"] : null,
          acceptEncoding: typeof req.headers["accept-encoding"] === "string" ? req.headers["accept-encoding"] : null,
          acceptLanguage: typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : null,
          connection: typeof req.headers["connection"] === "string" ? req.headers["connection"] : null,
          xHwid: typeof req.headers["x-hwid"] === "string" ? req.headers["x-hwid"] : null,
          xDeviceOs: typeof req.headers["x-device-os"] === "string" ? req.headers["x-device-os"] : null,
          xVerOs: typeof req.headers["x-ver-os"] === "string" ? req.headers["x-ver-os"] : null,
          xDeviceModel: typeof req.headers["x-device-model"] === "string" ? req.headers["x-device-model"] : null,
        },
      });

      if (result.ok === false) {
        res.status(result.status).send(result.message);
        return;
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("profile-update-interval", "12");

      res.status(200).send(result.body);
    } catch (error) {
      console.error("[GET /sub/:token] error:", error);
      res.status(500).send("Internal server error");
    }
  });

  app.get("/s/:token", async (req, res) => {
    const token = req.params.token ?? "";
    const subscription = await userService.findSubscriptionByPublicToken(token);

    if (!subscription) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    const rawSubscriptionUrl = subscription.rawSubscriptionUrl.trim();
    if (!rawSubscriptionUrl) {
      res.status(404).json({ error: "Subscription source is missing" });
      return;
    }

    if (subscription.status === "cancelled") {
      res.status(403).json({ error: "Subscription is not active" });
      return;
    }

    const expiresAtMs = new Date(subscription.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      res.status(403).json({ error: "Subscription expired" });
      return;
    }

    let upstream: Response;
    try {
      upstream = await fetch(rawSubscriptionUrl);
    } catch {
      res.status(502).json({ error: "Failed to load subscription" });
      return;
    }

    if (!upstream.ok) {
      res.status(502).json({ error: "Failed to load subscription" });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "text/plain; charset=utf-8";
    const body = await upstream.text();
    res.setHeader("content-type", contentType);
    res.status(200).send(body);
  });

  app.get("/key/:token", async (req, res) => {
    const token = req.params.token ?? "";
    const subscription = await userService.findSubscriptionByInstallToken(token);

    if (!subscription) {
      sendHtml(
        res,
        404,
        renderSimplePage({
          title: "Ключ не найден",
          message: "Проверьте ссылку или запросите новую в боте.",
        })
      );
      return;
    }

    if (subscription.status === "cancelled") {
      sendHtml(
        res,
        403,
        renderSimplePage({
          title: "Ключ неактивен",
          message: "Подписка отключена. Оформите новую подписку в боте.",
        })
      );
      return;
    }

    const expiresAtMs = new Date(subscription.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      sendHtml(
        res,
        403,
        renderSimplePage({
          title: "Срок действия ключа истёк",
          message: "Продлите подписку в боте, чтобы получить новый доступ.",
        })
      );
      return;
    }

    const hasActiveProxyToken =
      subscription.proxyToken.length > 0 && subscription.proxyToken !== subscription.publicToken;
    const targetToken = hasActiveProxyToken
      ? subscription.proxyToken
      : (subscription.publicToken || token);
    const appBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
    if (!appBase) {
      sendHtml(
        res,
        503,
        renderSimplePage({
          title: "Сервер не настроен",
          message:
            "Укажите в .env переменную APP_BASE_URL — публичный HTTPS-адрес этого приложения без завершающего слэша (например https://vpn.example.com).",
        })
      );
      return;
    }
    const shortSubscriptionUrl = `${appBase}/${encodeURIComponent(targetToken)}`;
    const encryptedHappLink = await happCryptoService.encryptSubscriptionUrl(shortSubscriptionUrl);
    const deepLinkUrl = encryptedHappLink ?? `happ://add/${shortSubscriptionUrl}`;
    const expiresAtText = new Date(subscription.expiresAt).toLocaleString("ru-RU");
    const statusText = subscription.status === "active" ? "активна" : subscription.status;

    sendHtml(
      res,
      200,
      renderInstallPage({
        planTitle: subscription.planTitle,
        statusText,
        expiresAtText,
        proxyPath: deepLinkUrl,
        proxyUrl: shortSubscriptionUrl,
      })
    );
  });

  app.get("/:token", async (req, res) => {
    try {
      const token = req.params.token ?? "";

      if (!token) {
        res.status(400).send("Token is required");
        return;
      }

      const reservedPaths = new Set([
        "health",
        "key",
        "sub",
        "proxy-sub",
        "s",
        "favicon.ico",
      ]);
      if (reservedPaths.has(token.toLowerCase())) {
        res.status(404).send("Not found");
        return;
      }

      const xForwardedFor = req.headers["x-forwarded-for"];
      const ip =
        typeof xForwardedFor === "string"
          ? xForwardedFor.split(",")[0]?.trim() ?? null
          : (req.socket.remoteAddress ?? null);
      const userAgent =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;

      const result = await subscriptionProxyService.getSubscriptionContent({
        token,
        ip,
        userAgent,
        clientHeaders: {
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          accept: typeof req.headers["accept"] === "string" ? req.headers["accept"] : null,
          acceptEncoding: typeof req.headers["accept-encoding"] === "string" ? req.headers["accept-encoding"] : null,
          acceptLanguage: typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : null,
          connection: typeof req.headers["connection"] === "string" ? req.headers["connection"] : null,
          xHwid: typeof req.headers["x-hwid"] === "string" ? req.headers["x-hwid"] : null,
          xDeviceOs: typeof req.headers["x-device-os"] === "string" ? req.headers["x-device-os"] : null,
          xVerOs: typeof req.headers["x-ver-os"] === "string" ? req.headers["x-ver-os"] : null,
          xDeviceModel: typeof req.headers["x-device-model"] === "string" ? req.headers["x-device-model"] : null,
        },
      });

      if (result.ok === false) {
        res.status(result.status).send(result.message);
        return;
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("profile-update-interval", "12");

      res.status(200).send(result.body);
    } catch (error) {
      console.error("[GET /:token] error:", error);
      res.status(500).send("Internal server error");
    }
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });

  return {
    app,
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}
