// Переход между экранами без перезагрузки страницы. Перезагрузка выводит браузер из полного
// экрана, а на телефоне вернуть его можно только жестом, поэтому из меню в матч игрок попадает
// внутри одной страницы: полный экран, включённый нажатием «Играть», остаётся.
import { useEffect, useState } from 'react';

const EVENT = 'hexfront:navigate';

/** Открывает адрес внутри приложения и сообщает об этом экранам. */
export function navigate(url: string): void {
  window.history.pushState(null, '', url);
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

export interface AppLocation {
  readonly pathname: string;
  readonly search: string;
}

function read(): AppLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Текущий адрес; экран перерисовывается при переходе и при «назад». */
export function useLocation(): AppLocation {
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = (): void => {
      const next = read();
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
