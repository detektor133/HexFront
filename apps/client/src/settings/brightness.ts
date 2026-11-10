// Настройка яркости карты: проценты, хранится в браузере игрока. Мониторы у всех разные, и обычная
// карта многим кажется слишком яркой; затемняется только карта, интерфейс остаётся как есть.
import { useEffect, useState } from 'react';

const KEY = 'hexfront.brightness';

/** Пределы и шаг ползунка, %. */
export const BRIGHTNESS_MIN = 50;
export const BRIGHTNESS_MAX = 120;
export const BRIGHTNESS_STEP = 5;
export const BRIGHTNESS_DEFAULT = 100;

const listeners = new Set<() => void>();

/** Приводит значение к допустимому: целое число процентов в пределах ползунка. */
export function clampBrightness(value: number): number {
  if (!Number.isFinite(value)) return BRIGHTNESS_DEFAULT;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round(value)));
}

/** Сохранённая яркость, %; без записи или без доступа к хранилищу — 100. */
export function readBrightness(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? BRIGHTNESS_DEFAULT : clampBrightness(Number(raw));
  } catch {
    return BRIGHTNESS_DEFAULT;
  }
}

/** Запоминает яркость и оповещает подписчиков (карта на странице меняется сразу). */
export function writeBrightness(value: number): void {
  const next = clampBrightness(value);
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // Хранилище закрыто (приватное окно): настройка действует до перезагрузки страницы.
    memory = next;
  }
  for (const listener of listeners) listener();
}

let memory: number | null = null;

/** Текущая яркость, %: запись из хранилища или значение из памяти, если хранилище закрыто. */
export function currentBrightness(): number {
  return memory ?? readBrightness();
}
const current = currentBrightness;

/** Подписка на смену яркости; возвращает отписку. */
export function onBrightness(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Яркость карты, % и её запись; компонент перерисовывается при смене. */
export function useBrightness(): readonly [number, (value: number) => void] {
  const [value, setValue] = useState(current);
  useEffect(() => onBrightness(() => setValue(current())), []);
  return [value, writeBrightness];
}

/** Стиль слоя карты для яркости; при 100 % фильтра нет, чтобы не тратить кадр на пустую работу. */
export function brightnessStyle(percent: number): React.CSSProperties | undefined {
  return percent === BRIGHTNESS_DEFAULT ? undefined : { filter: `brightness(${percent / 100})` };
}
