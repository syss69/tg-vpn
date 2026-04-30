import "dotenv/config";

import { initDatabase } from "./db/init";
import { closePool } from "./db/pool";
import { startWebServer } from "./web/server";

/**
 * Точка входа приложения.
 * Поднимает БД и HTTP-сервер (ссылки подписки, Happ); Telegram-бот — если START_TELEGRAM_BOT !== "false".
 */
async function main(): Promise<void> {
  const shouldStartTelegramBot = process.env.START_TELEGRAM_BOT !== "false";

  if (!process.env.DATABASE_URL) {
    console.error(
      "❌ Переменная DATABASE_URL не установлена!\n" +
        "Проверьте файл .env (он должен лежать в корне проекта)."
    );
    process.exit(1);
  }

  try {
    await initDatabase();
    console.log("✅ Подключение к PostgreSQL установлено.");
  } catch (err) {
    console.error("❌ Не удалось подключиться к PostgreSQL:", err);
    process.exit(1);
  }

  const webServer = await startWebServer();
  console.log(`✅ Web server запущен на порту ${webServer.port}.`);

  let bot:
    | {
        start: (options?: {
          onStart?: (info: { username: string }) => void;
        }) => Promise<void>;
        stop: () => Promise<void>;
      }
    | null = null;

  if (shouldStartTelegramBot) {
    const token = process.env.BOT_TOKEN;

    if (!token) {
      console.error("❌ Переменная BOT_TOKEN не установлена в .env");
      process.exit(1);
    }

    console.log("🚀 Запуск Telegram-бота...");
    const { createBot } = await import("./bot/bot");
    bot = createBot(token);
  } else {
    console.log("ℹ️ Telegram bot disabled (START_TELEGRAM_BOT=false)");
  }

  const shutdown = async () => {
    console.log("\n🛑 Остановка приложения...");
    if (bot) {
      await bot.stop();
    }
    await webServer.close();
    await closePool();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (bot) {
    await bot.start({
      onStart: (info) => {
        console.log(`✅ Бот @${info.username} успешно запущен!`);
      },
    });
  }
}

main().catch((err) => {
  console.error("💥 Критическая ошибка:", err);
  process.exit(1);
});
