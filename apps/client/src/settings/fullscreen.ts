// Полный экран на телефоне: адресная строка браузера съедает место, а страница не прокручивается,
// поэтому строка сама не прячется. Android Chrome даёт режим «во весь экран» по нажатию; iPhone
// не даёт, там помогает установка на экран «Домой» (режим standalone, манифест).
import { useEffect, useState } from 'react';

const KEY = 'hexfront.fullscreen';

/** Страница уже открыта как приложение (с экрана «Домой»): адресной строки нет. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true || (window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  );
}

/** iPhone и iPad: полного экрана через API нет. */
export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Браузер умеет переводить страницу во весь экран. */
export function fullscreenSupported(): boolean {
  return (
    typeof (document.documentElement as HTMLElement | undefined)?.requestFullscreen === 'function'
  );
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

/** Игрок не выключал автоматический полный экран на телефоне. */
export function fullscreenWanted(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

function remember(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Хранилище закрыто: выбор действует до перезагрузки.
  }
}

/** Включает или выключает полный экран; вызывается из нажатия пальцем (жест пользователя обязателен). */
export async function setFullscreen(on: boolean): Promise<void> {
  remember(on);
  try {
    if (on && !isFullscreen()) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    if (!on && isFullscreen()) await document.exitFullscreen();
  } catch {
    // Браузер отказал (нет жеста, запрет политики): остаёмся в обычном окне.
  }
}

/** Состояние полного экрана; обновляется при входе и выходе. */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const update = (): void => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return on;
}

/**
 * Первое нажатие пальцем в матче переводит страницу во весь экран (браузер требует жест).
 * @returns отписка
 */
export function enterFullscreenOnFirstTap(): () => void {
  if (!fullscreenSupported() || isStandalone() || !fullscreenWanted()) return () => undefined;
  if (!(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return () => undefined;
  // Слушатель живёт, пока открыт экран: система может вывести из полного экрана (жест «назад»,
  // уведомление), и следующее же нажатие возвращает его, а не только первое после загрузки.
  const handler = (): void => {
    if (!isFullscreen() && fullscreenWanted()) void setFullscreen(true);
  };
  document.addEventListener('pointerup', handler);
  return () => document.removeEventListener('pointerup', handler);
}
