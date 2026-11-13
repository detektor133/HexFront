// Вид меню земли: по умолчанию прежнее окно, выбор запоминается, лишние значения отбрасываются.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MENU_STYLE,
  MENU_STYLES,
  nextMenuStyle,
  readMenuStyle,
  writeMenuStyle,
} from '../src/settings/menu-style.ts';

describe('вид меню земли', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    writeMenuStyle(DEFAULT_MENU_STYLE);
  });

  it('по умолчанию — прежнее окно, всего пять форм', () => {
    expect(readMenuStyle()).toBe('menu');
    expect(MENU_STYLES).toEqual(['menu', 'pill', 'radial', 'tiles', 'drawer']);
  });

  it('выбор запоминается; неизвестное значение заменяется умолчанием', () => {
    writeMenuStyle('radial');
    expect(readMenuStyle()).toBe('radial');
    store.set('hexfront.territoryMenuStyle', 'ladder');
    expect(readMenuStyle()).toBe('menu');
  });

  it('переключатель идёт по кругу', () => {
    expect(nextMenuStyle('menu')).toBe('pill');
    expect(nextMenuStyle('drawer')).toBe('menu');
  });
});
