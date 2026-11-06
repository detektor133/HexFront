// Тема интерфейса «Мята» (docs/art/themes.json): применяется атрибутом data-theme на <html>.
// Выбор стиля игроку не показывается: остальные темы отвергнуты владельцем 2026-11-06.
import { defaultTheme, type ThemeId } from './themes.ts';

export type { ThemeId };

/** Тема интерфейса: единственная, «Мята». */
export function currentTheme(): ThemeId {
  return defaultTheme;
}

/** Применяет тему к документу при старте. */
export function applyTheme(
  id: ThemeId,
  root: HTMLElement | undefined = document.documentElement,
): void {
  if (root) root.dataset.theme = id;
}
