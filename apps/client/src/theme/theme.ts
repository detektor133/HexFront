// Выбор темы интерфейса: хранится в localStorage, применяется атрибутом data-theme на <html>.
// Тема меняет только токены ui/status/radius/shadow (docs/art/themes.json), карту не трогает.
import { defaultTheme, themeIds, type ThemeId } from './themes.ts';

export { themeIds, type ThemeId };

const KEY = 'hexfront.theme';

function isThemeId(value: string | null): value is ThemeId {
  return themeIds.some((id) => id === value);
}

/** Сохранённая тема игрока или тема по умолчанию. */
export function currentTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    return isThemeId(saved) ? saved : defaultTheme;
  } catch {
    // Хранилище закрыто (приватный режим): остаётся тема по умолчанию.
    return defaultTheme;
  }
}

/** Применяет тему к документу; вызывается при старте и при выборе в настройках. */
export function applyTheme(
  id: ThemeId,
  root: HTMLElement | undefined = document.documentElement,
): void {
  if (root) root.dataset.theme = id;
}

/** Запоминает выбор игрока и применяет тему сразу. */
export function chooseTheme(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Выбор действует до перезагрузки страницы.
  }
  applyTheme(id);
}
