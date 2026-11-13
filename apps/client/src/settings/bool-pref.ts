// Простые настройки «вкл/выкл» с хранением в браузере: экран настроек и матч видят одно значение.
import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

/** Сохранённое значение или значение по умолчанию. */
export function readBoolPref(key: string, fallback: boolean): boolean {
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    const saved = localStorage.getItem(`hexfront.${key}`);
    return saved === null ? fallback : saved === 'on';
  } catch {
    return fallback;
  }
}

/** Запоминает значение и оповещает подписчиков. */
export function writeBoolPref(key: string, on: boolean): void {
  memory.set(key, on);
  try {
    localStorage.setItem(`hexfront.${key}`, on ? 'on' : 'off');
  } catch {
    // Хранилище закрыто: значение действует до перезагрузки страницы.
  }
  for (const listener of listeners) listener();
}

/** Подписка на любое изменение настроек «вкл/выкл»; возвращает отписку. */
export function onBoolPrefChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Значение настройки и его запись; компонент перерисовывается при смене. */
export function useBoolPref(
  key: string,
  fallback: boolean,
): readonly [boolean, (on: boolean) => void] {
  const [value, setValue] = useState(() => readBoolPref(key, fallback));
  useEffect(() => onBoolPrefChange(() => setValue(readBoolPref(key, fallback))), [key, fallback]);
  return [value, (on) => writeBoolPref(key, on)];
}

/** Подписи государств на карте. */
export const PREF_TERRITORY_LABELS = 'territoryLabels';

/** Время показа записи в ленте событий, секунд. */
export const PREF_EVENT_SECONDS = 'eventSeconds';
export const EVENT_SECONDS_CHOICES = [10, 20, 40] as const;
/** Скорость зума колесом: множитель к прежнему шагу. */
export const PREF_ZOOM_SPEED = 'zoomSpeed';
export const ZOOM_SPEED_CHOICES = [0.5, 1, 1.5] as const;
/** Инерция карты после броска пальцем или мышью. */
export const PREF_INERTIA = 'inertia';
/** Пинг показывается всегда, а не только когда связь плохая. */
export const PREF_SHOW_PING = 'showPing';

const numbers = new Map<string, number>();

/** Сохранённое число-настройка или значение по умолчанию. */
export function readNumberPref(key: string, fallback: number): number {
  const kept = numbers.get(key);
  if (kept !== undefined) return kept;
  try {
    const saved = Number(localStorage.getItem(`hexfront.${key}`));
    return localStorage.getItem(`hexfront.${key}`) === null || !Number.isFinite(saved)
      ? fallback
      : saved;
  } catch {
    return fallback;
  }
}

/** Запоминает число и оповещает подписчиков. */
export function writeNumberPref(key: string, value: number): void {
  numbers.set(key, value);
  try {
    localStorage.setItem(`hexfront.${key}`, String(value));
  } catch {
    // Хранилище закрыто: значение действует до перезагрузки страницы.
  }
  for (const listener of listeners) listener();
}

/** Число-настройка и его запись; компонент перерисовывается при смене. */
export function useNumberPref(
  key: string,
  fallback: number,
): readonly [number, (value: number) => void] {
  const [value, setValue] = useState(() => readNumberPref(key, fallback));
  useEffect(() => onBoolPrefChange(() => setValue(readNumberPref(key, fallback))), [key, fallback]);
  return [value, (next) => writeNumberPref(key, next)];
}

/** Возвращает все настройки этого файла к значениям по умолчанию. */
export function resetPrefs(): void {
  for (const key of [
    PREF_TERRITORY_LABELS,
    PREF_EVENT_SECONDS,
    PREF_ZOOM_SPEED,
    PREF_INERTIA,
    PREF_SHOW_PING,
  ]) {
    memory.delete(key);
    numbers.delete(key);
    try {
      localStorage.removeItem(`hexfront.${key}`);
    } catch {
      // Хранилище закрыто: нечего стирать.
    }
  }
  for (const listener of listeners) listener();
}
