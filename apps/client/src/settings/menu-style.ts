// Вид меню чужой и ничьей земли (клик по территории), хранится в браузере: пока выбираем лучший.
import { useEffect, useState } from 'react';

export const MENU_STYLES = ['menu', 'pill', 'radial', 'tiles', 'drawer'] as const;
export type MenuStyle = (typeof MENU_STYLES)[number];

const KEY = 'hexfront.territoryMenuStyle';
export const DEFAULT_MENU_STYLE: MenuStyle = 'menu';
const listeners = new Set<() => void>();
let memory: MenuStyle | null = null;

/** Сохранённый вид меню земли или вид по умолчанию. */
export function readMenuStyle(): MenuStyle {
  if (memory !== null) return memory;
  try {
    const saved = localStorage.getItem(KEY);
    return MENU_STYLES.find((style) => style === saved) ?? DEFAULT_MENU_STYLE;
  } catch {
    return DEFAULT_MENU_STYLE;
  }
}

/** Запоминает вид и оповещает подписчиков. */
export function writeMenuStyle(style: MenuStyle): void {
  try {
    localStorage.setItem(KEY, style);
    memory = null;
  } catch {
    // Хранилище закрыто: выбор действует до перезагрузки страницы.
    memory = style;
  }
  for (const listener of listeners) listener();
}

/** Следующий вид по кругу: переключатель «n/5» в самом меню. */
export function nextMenuStyle(style: MenuStyle): MenuStyle {
  return MENU_STYLES[(MENU_STYLES.indexOf(style) + 1) % MENU_STYLES.length] ?? DEFAULT_MENU_STYLE;
}

/** Вид меню земли и его запись; компонент перерисовывается при смене. */
export function useMenuStyle(): readonly [MenuStyle, (style: MenuStyle) => void] {
  const [value, setValue] = useState<MenuStyle>(readMenuStyle);
  useEffect(() => {
    const listener = (): void => setValue(readMenuStyle());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [value, writeMenuStyle];
}
