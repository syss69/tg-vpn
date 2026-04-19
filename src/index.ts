import { createBot } from "./bot/bot";
import { initDatabase } from "./db/init";
import { closePool } from "./db/pool";

/**
 * Точка входа приложения.
 * Читает токен из переменных окружения и запускает бота.
 */
async function main(): Promise<void> {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.error(
      "❌ Переменная окружения BOT_TOKEN не установлена!\n" +
        "Создайте файл .env или установите переменную вручную:\n" +
        "export BOT_TOKEN=ваш_токен"
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "❌ Переменная DATABASE_URL не установлена!\n" +
        "Укажите строку подключения PostgreSQL в .env, например:\n" +
        "DATABASE_URL=postgresql://user:pass@localhost:5432/tg_bot"
    );
    process.exit(1);
  }

  console.log("🚀 Запуск Telegram-бота...");

  try {
    await initDatabase();
    console.log("✅ Подключение к PostgreSQL установлено.");
  } catch (err) {
    console.error("❌ Не удалось подключиться к PostgreSQL:", err);
    process.exit(1);
  }

  const bot = createBot(token);

  const shutdown = async () => {
    console.log("\n🛑 Остановка бота...");
    await bot.stop();
    await closePool();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await bot.start({
    onStart: (info) => {
      console.log(`✅ Бот @${info.username} успешно запущен!`);
      console.log(`📁 База данных: PostgreSQL`);
    },
  });
}

main().catch((err) => {
  console.error("💥 Критическая ошибка при запуске:", err);
  process.exit(1);
});
