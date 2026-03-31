/**
 * Сервис для выдачи трафика по белому списку.
 */
export class TrafficService {
  /**
   * Возвращает шаблон трафика для магазина: white_list_${gb}.
   */
  getTrafficCode(gb: number): string {
    return `white_list_${gb}`;
  }

  /**
   * Извлекает объём трафика из itemId вида white_list_${gb}.
   */
  parseGbFromItemId(itemId: string): number | null {
    const match = itemId.match(/^white_list_(\d+)$/);
    if (!match) return null;
    const gb = Number(match[1]);
    if (!Number.isFinite(gb) || gb <= 0) return null;
    return gb;
  }
}
