// Размер видимой области страницы на телефоне: адресная строка браузера то прячется, то показывается,
// экран поворачивается — раскладка перечитывает размер на каждом таком событии.
import { useEffect, useState } from 'react';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Размер видимой области: visualViewport точнее innerHeight, когда адресная строка уезжает. */
export function readViewport(): ViewportSize {
  const visual = window.visualViewport;
  return {
    width: Math.round(visual?.width ?? window.innerWidth),
    height: Math.round(visual?.height ?? window.innerHeight),
  };
}

/** Размер видимой области; компонент перерисовывается при смене размера и поворота. */
export function useViewport(): ViewportSize {
  const [size, setSize] = useState(readViewport);
  useEffect(() => {
    const update = (): void => {
      const next = readViewport();
      setSize((now) => (now.width === next.width && now.height === next.height ? now : next));
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  return size;
}
