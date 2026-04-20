import { BotContext } from "../bot";
import { backToMenuKeyboard } from "../keyboards";

function buildDownloadAppGuideText(): string {
  return (
    `📱 <b>Установка Happ — короткий гайд</b>\n\n` +
    `🔹 <b>Happ</b> — приложение, которое помогает работать с VLESS-конфигурациями.\n\n` +
    `📥 <b>Шаг 1 — установите приложение</b>\n` +
    `Выберите вашу платформу:\n\n` +
    `📱 <b>iOS (iPhone/iPad)</b>\n` +
    `• <a href="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">App Store</a>\n` +
    `• Требуется iOS 16.0 или новее\n\n` +
    `🤖 <b>Android</b>\n` +
    `• <a href="https://play.google.com/store/apps/details?id=com.happproxy">Google Play</a>\n\n` +
    `💻 <b>Windows</b>\n` +
    `• <a href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe">Скачайте установщик</a>\n` +
    `• Запустите <code>setup-Happ.x64.exe</code> и следуйте шагам установки\n\n` +
    `🍎 <b>macOS</b>\n` +
    `• <a href="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">App Store</a>\n` +
    `• Требуется macOS 13.0 или новее\n\n` +
    `📋 <b>Шаг 2 — импортируйте конфигурацию</b>\n` +
    `После установки:\n` +
    `1) Откройте Happ\n` +
    `2) В боте нажмите «Профиль» и скопируйте ссылку на конфигурацию Вашей подписки \n` +
    `3) Конфигурация импортируется в приложение\n` +
    `4) Нажмите «Подключиться» в Happ\n\n` +
    `✨ <b>Что дают наши конфигурации</b>\n` +
    `• VLESS — для высокой скорости\n` +
    `• оптимизация маршрутов к устаревшему иностранному оборудованию\n` +
    `• запуск за пару минут без сложной настройки\n\n` +
    `📲 <b>Поддерживаемые клиенты</b>\n` +
    `• Happ\n` +
    `• V2RayTun\n` +
    `• Hiddify\n` +
    `• V2Box\n` +
    `• v2rayNG\n` +
    `• OpenVPN Connect\n\n` +
    `❓ Если появятся вопросы — напишите в поддержку.`
  );
}

export async function handleDownloadApp(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(buildDownloadAppGuideText(), {
    parse_mode: "HTML",
    reply_markup: backToMenuKeyboard,
  });
}

