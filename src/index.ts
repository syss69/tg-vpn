import { createBot } from "./bot/bot";

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

  console.log("🚀 Запуск Telegram-бота...");

  const bot = createBot(token);

  // Корректное завершение при SIGINT / SIGTERM
  const shutdown = () => {
    console.log("\n🛑 Остановка бота...");
    bot.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // Запускаем бота через long polling
  await bot.start({
    onStart: (info) => {
      console.log(`✅ Бот @${info.username} успешно запущен!`);
      console.log(`📁 База данных: src/data/db.json`);
    },
  });
}

main().catch((err) => {
  console.error("💥 Критическая ошибка при запуске:", err);
  process.exit(1);
});
