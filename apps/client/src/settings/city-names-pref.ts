// Свой список названий городов игрока: хранится в браузере и уходит в матч (локальный и сетевой).
// Новые города игрока берут названия из списка по порядку; когда он кончился, названия слоговые.
import { cleanCityPool } from '@hexfront/sim';

const KEY = 'hexfront.cityNames';

/** Сохранённый список (уже очищенный) или пустой. */
export function readCityNames(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? cleanCityPool(parsed.filter((n): n is string => typeof n === 'string'))
      : [];
  } catch {
    return [];
  }
}

/** Запоминает список; возвращает то, что действительно сохранено. */
export function writeCityNames(names: readonly string[]): string[] {
  const clean = cleanCityPool(names);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Хранилище закрыто: список действует до перезагрузки страницы.
  }
  return clean;
}
