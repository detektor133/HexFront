// Открытие и закрытие окон «как у лампового телевизора»: картинка вспыхивает полоской, растягивается
// по ширине, затем по высоте; закрываясь, сжимается в полоску и гаснет точкой.
import { useEffect, useRef, useState } from 'react';

import styles from './tv-window.module.css';

/** Длительность закрытия, мс: окно остаётся в дереве, пока играет анимация (см. tv-window.module.css). */
export const TV_CLOSE_MS = 320;

export interface TvPresence {
  /** Окно ещё нужно держать в дереве (открыто или закрывается). */
  readonly mounted: boolean;
  /** Класс анимации для корневого элемента окна. */
  readonly className: string;
}

/** Держит окно в дереве на время анимации закрытия и отдаёт класс текущей фазы. */
export function useTvPresence(open: boolean): TvPresence {
  const [mounted, setMounted] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      return;
    }
    timer.current = setTimeout(() => setMounted(false), TV_CLOSE_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [open]);

  // Класс зависит только от open: окно закрывается в тот же кадр, когда его попросили закрыться.
  return { mounted: mounted || open, className: (open ? styles.on : styles.off) ?? '' };
}
