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
