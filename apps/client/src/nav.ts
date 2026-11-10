// Одностраничное приложение: меню и матч — экраны одной страницы, адрес в строке браузера не
// меняется, страница не перезагружается. Перезагрузка выводит браузер из полного экрана, а на
// телефоне вернуть его можно только жестом, поэтому «Играть» просто подменяет экран на месте.
//
// Текущий экран лежит в `history.state`: «назад» возвращает в меню, перезагрузка остаёт в том же
// экране, а прямые ссылки вида `/match?...` и dev-страницы работают как раньше.
import { useEffect, useState } from 'react';

const EVENT = 'hexfront:navigate';

/** Экраны, которые открываются на месте, без смены адреса. */
const IN_PLACE_PATHS: ReadonlySet<string> = new Set(['/', '/menu', '/match']);

export interface AppLocation {
  readonly pathname: string;
  readonly search: string;
}

interface StoredScreen {
  readonly hexfront: AppLocation;
}

function isStoredScreen(state: unknown): state is StoredScreen {
  if (typeof state !== 'object' || state === null || !('hexfront' in state)) return false;
  const screen = (state as { hexfront: unknown }).hexfront;
  return (
    typeof screen === 'object' &&
    screen !== null &&
    typeof (screen as AppLocation).pathname === 'string' &&
    typeof (screen as AppLocation).search === 'string'
  );
}

/** Текущий экран: сохранённый в истории или заданный адресной строкой. */
export function readLocation(): AppLocation {
  // Тестовые окна без истории: тогда экран задаёт только адресная строка.
  const state: unknown = (window as { history?: History }).history?.state;
  if (isStoredScreen(state)) return state.hexfront;
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Строка параметров текущего экрана (то, что раньше читали из `window.location.search`). */
export function appSearch(): string {
  return readLocation().search;
}

/** Открывает адрес внутри приложения и сообщает об этом экранам. */
export function navigate(url: string): void {
  const target = new URL(url, window.location.origin);
  if (IN_PLACE_PATHS.has(target.pathname)) {
    const screen: AppLocation = { pathname: target.pathname, search: target.search };
    window.history.pushState({ hexfront: screen } satisfies StoredScreen, '', '/');
  } else {
    window.history.pushState(null, '', url);
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Обработчик нажатия по ссылке: обычное нажатие идёт внутри приложения, с Ctrl/⌘ и средней кнопкой — как у браузера. */
export function followInApp(event: React.MouseEvent<HTMLAnchorElement>, url: string): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  navigate(url);
  return true;
}

/** Текущий экран; перерисовывается при переходе и при «назад». */
export function useLocation(): AppLocation {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const update = (): void => {
      const next = readLocation();
      setLocation((now) =>
        now.pathname === next.pathname && now.search === next.search ? now : next,
      );
    };
    window.addEventListener(EVENT, update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}
