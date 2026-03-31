import * as fs from "fs";
import * as path from "path";
import { Database, User, ApiKey } from "../types";

/** Путь к файлу базы данных */
const DB_PATH = path.join(__dirname, "../data/db.json");

/**
 * Сервис для работы с пользователями.
 * Инкапсулирует всю логику чтения и записи в JSON-файл.
 */
export class UserService {
  /**
   * Читает базу данных из JSON-файла.
   * @returns Объект базы данных
   */
  private readDB(): Database {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw) as Database;
  }

  /**
   * Записывает базу данных в JSON-файл.
   * @param db - Объект базы данных для сохранения
   */
  private writeDB(db: Database): void {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  }

  /**
   * Находит пользователя по его Telegram ID.
   * @param userId - Telegram ID пользователя
   * @returns Пользователь или undefined, если не найден
   */
  findById(userId: number): User | undefined {
    const db = this.readDB();
    return db.users.find((u) => u.id === userId);
  }

  /**
   * Создаёт нового пользователя и сохраняет его в базе данных.
   * @param userId - Telegram ID пользователя
   * @param username - Имя пользователя в Telegram
   * @returns Созданный пользователь
   */
  createUser(userId: number, username?: string): User {
    const db = this.readDB();
    const newUser: User = {
      id: userId,
      username,
      balance: 0,
      purchasedKeys: [],
      trafficWalletGb: 0,
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    this.writeDB(db);
    return newUser;
  }

  /**
   * Возвращает пользователя, создавая его при первом обращении.
   * @param userId - Telegram ID пользователя
   * @param username - Имя пользователя в Telegram
   * @returns Существующий или новый пользователь
   */
  getOrCreate(userId: number, username?: string): User {
    const user = this.findById(userId) ?? this.createUser(userId, username);
    if (typeof user.trafficWalletGb !== "number") {
      user.trafficWalletGb = 0;
      const db = this.readDB();
      const target = db.users.find((u) => u.id === userId);
      if (target) {
        target.trafficWalletGb = 0;
        this.writeDB(db);
      }
    }
    return user;
  }

  /**
   * Пополняет баланс пользователя на указанную сумму.
   * @param userId - Telegram ID пользователя
   * @param amount - Сумма пополнения (положительное число)
   * @returns Обновлённый пользователь или null, если пользователь не найден
   */
  topUpBalance(userId: number, amount: number): User | null {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;

    user.balance += amount;
    this.writeDB(db);
    return user;
  }

  /**
   * Списывает средства с баланса пользователя.
   * @param userId - Telegram ID пользователя
   * @param amount - Сумма списания
   * @returns true — если успешно, false — если недостаточно средств или пользователь не найден
   */
  deductBalance(userId: number, amount: number): boolean {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user || user.balance < amount) return false;

    user.balance -= amount;
    this.writeDB(db);
    return true;
  }

  /**
   * Добавляет купленный ключ в список пользователя.
   * @param userId - Telegram ID пользователя
   * @param key - Объект ключа для добавления
   */
  addKeyToUser(userId: number, key: ApiKey): void {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return;

    user.purchasedKeys.push(key);
    this.writeDB(db);
  }

  /**
   * Начисляет трафик на конкретный API-ключ пользователя.
   * @param userId - Telegram ID пользователя
   * @param keyId - Идентификатор ключа
   * @param trafficGb - Объем трафика в GB
   * @returns true — если ключ найден и обновлён, иначе false
   */
  addTrafficToKey(userId: number, keyId: string, trafficGb: number): boolean {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return false;

    const key = user.purchasedKeys.find((k) => k.id === keyId);
    if (!key) return false;

    key.totalTrafficGb = (key.totalTrafficGb ?? 0) + trafficGb;
    if (typeof key.usedTrafficGb !== "number") {
      key.usedTrafficGb = 0;
    }
    user.trafficWalletGb = (user.trafficWalletGb ?? 0) + trafficGb;
    this.writeDB(db);
    return true;
  }

  isKeyExpired(key: ApiKey): boolean {
    if (!key.expiresAt) return false;
    return new Date(key.expiresAt).getTime() <= Date.now();
  }

  getActiveKeys(userId: number): ApiKey[] {
    const user = this.findById(userId);
    if (!user) return [];
    return user.purchasedKeys.filter((key) => !this.isKeyExpired(key));
  }

  /**
   * Тестовый метод: уменьшает остаток трафика у ключа по его номеру в списке.
   * @param userId - Telegram ID пользователя
   * @param keyNumber - Номер ключа (1-based, как в профиле)
   * @param gb - Сколько GB списать
   * @returns Объект с результатом операции
   */
  reduceTrafficByKeyNumber(
    userId: number,
    keyNumber: number,
    gb: number
  ): {
    success: boolean;
    reason?: string;
    keyValue?: string;
    remainingGb?: number;
    usedGb?: number;
    totalGb?: number;
  } {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { success: false, reason: "Пользователь не найден." };

    if (keyNumber < 1 || keyNumber > user.purchasedKeys.length) {
      return { success: false, reason: "Неверный номер ключа." };
    }

    const key = user.purchasedKeys[keyNumber - 1];
    if (this.isKeyExpired(key)) {
      return { success: false, reason: "Ключ сгорел. С него нельзя списывать трафик." };
    }
    const total = key.totalTrafficGb ?? 0;
    const used = key.usedTrafficGb ?? 0;
    const remaining = Math.max(total - used, 0);

    if (gb > remaining) {
      return {
        success: false,
        reason: `Недостаточно трафика. Остаток: ${remaining} GB.`,
      };
    }

    key.usedTrafficGb = used + gb;
    const nextRemaining = Math.max(total - (key.usedTrafficGb ?? 0), 0);
    this.writeDB(db);

    return {
      success: true,
      keyValue: key.value,
      remainingGb: nextRemaining,
      usedGb: key.usedTrafficGb,
      totalGb: total,
    };
  }

  rebindRemainingTrafficByNumbers(
    userId: number,
    fromKeyNumber: number,
    toKeyNumber: number
  ): {
    success: boolean;
    reason?: string;
    movedGb?: number;
    fromKey?: string;
    toKey?: string;
  } {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { success: false, reason: "Пользователь не найден." };

    if (
      fromKeyNumber < 1 ||
      toKeyNumber < 1 ||
      fromKeyNumber > user.purchasedKeys.length ||
      toKeyNumber > user.purchasedKeys.length
    ) {
      return { success: false, reason: "Неверные номера ключей." };
    }

    const fromKey = user.purchasedKeys[fromKeyNumber - 1];
    const toKey = user.purchasedKeys[toKeyNumber - 1];
    if (fromKey.id === toKey.id) {
      return { success: false, reason: "Нужно выбрать разные ключи." };
    }

    if (!this.isKeyExpired(fromKey)) {
      return { success: false, reason: "Источник не сгорел. Перепривязка доступна только для сгоревшего ключа." };
    }

    if (this.isKeyExpired(toKey)) {
      return { success: false, reason: "Целевой ключ тоже сгорел. Нужен активный ключ." };
    }

    const fromTotal = fromKey.totalTrafficGb ?? 0;
    const fromUsed = fromKey.usedTrafficGb ?? 0;
    const remaining = Math.max(fromTotal - fromUsed, 0);
    if (remaining <= 0) {
      return { success: false, reason: "На сгоревшем ключе нет остатка для переноса." };
    }

    fromKey.totalTrafficGb = fromUsed;
    toKey.totalTrafficGb = (toKey.totalTrafficGb ?? 0) + remaining;
    if (typeof toKey.usedTrafficGb !== "number") {
      toKey.usedTrafficGb = 0;
    }

    this.writeDB(db);
    return {
      success: true,
      movedGb: remaining,
      fromKey: fromKey.value,
      toKey: toKey.value,
    };
  }

  /**
   * Тестовый метод: удаляет ключ по его номеру в списке пользователя.
   * @param userId - Telegram ID пользователя
   * @param keyNumber - Номер ключа (1-based)
   * @returns Результат удаления
   */
  deleteKeyByNumber(
    userId: number,
    keyNumber: number
  ): {
    success: boolean;
    reason?: string;
    keyValue?: string;
    wasExpired?: boolean;
    remainingTrafficGb?: number;
  } {
    const db = this.readDB();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { success: false, reason: "Пользователь не найден." };

    if (keyNumber < 1 || keyNumber > user.purchasedKeys.length) {
      return { success: false, reason: "Неверный номер ключа." };
    }

    const key = user.purchasedKeys[keyNumber - 1];
    const total = key.totalTrafficGb ?? 0;
    const used = key.usedTrafficGb ?? 0;
    const remaining = Math.max(total - used, 0);
    const wasExpired = this.isKeyExpired(key);

    user.purchasedKeys.splice(keyNumber - 1, 1);
    this.writeDB(db);

    return {
      success: true,
      keyValue: key.value,
      wasExpired,
      remainingTrafficGb: remaining,
    };
  }
}
