import { useEffect, useRef, useState } from 'react';

import styles from './RollNumber.module.css';

/** Не чаще раза за это время число меняет показ: при потерях каждый тик иначе рвёт анимацию. */
const MIN_STEP_MS = 450;

interface Shown {
  readonly value: number;
  readonly text: string;
  readonly turn: number;
  readonly direction: 'up' | 'down' | null;
}

/**
 * Число с анимацией смены: основное «прокручивается» по вертикали (вверх при росте, вниз при
 * убыли), предел — другим движением (выезд сбоку со вспышкой). Первая отрисовка без анимации.
 * Частые изменения (потери в бою, нехватка снабжения) собираются: показ обновляется не чаще
 * раза в `MIN_STEP_MS`, и анимация доигрывает до конца, а не перезапускается каждый тик.
 */
export function RollNumber(props: {
  /** Значение для сравнения: направление анимации выводится из его изменения. */
  readonly value: number;
  /** Что показать (сокращённая запись: 2,3к). */
  readonly text: string;
  readonly kind: 'main' | 'limit';
  readonly className?: string | undefined;
  readonly title?: string | undefined;
}): React.JSX.Element {
  const [shown, setShown] = useState<Shown>({
    value: props.value,
    text: props.text,
    turn: 0,
    direction: null,
  });
  const lastChange = useRef(0);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (props.value === shown.value) {
      // Значение то же, а подпись могла смениться (язык): обновляем без анимации.
      if (props.text !== shown.text) setShown({ ...shown, text: props.text });
      return undefined;
    }
    // Сокращённая запись (2,3к) не изменилась — анимировать нечего: значение обновляется молча.
    if (props.text === shown.text) {
      setShown({ ...shown, value: props.value });
      return undefined;
    }
    const apply = (): void => {
      const now = latest.current;
      lastChange.current = performance.now();
      setShown((was) =>
        now.value === was.value
          ? was
          : {
              value: now.value,
              text: now.text,
              turn: was.turn + 1,
              direction: now.value > was.value ? 'up' : 'down',
            },
      );
    };
    const wait = lastChange.current + MIN_STEP_MS - performance.now();
    if (wait <= 0) {
      apply();
      return undefined;
    }
    const timer = window.setTimeout(apply, wait);
    return () => window.clearTimeout(timer);
  }, [props.value, props.text, shown]);

  const motion =
    shown.direction === null
      ? ''
      : props.kind === 'limit'
        ? styles.limitChange
        : shown.direction === 'up'
          ? styles.rollUp
          : styles.rollDown;
  return (
    <span className={`${styles.frame} ${props.className ?? ''}`} title={props.title}>
      <span key={shown.turn} className={`${styles.value} ${motion}`}>
        {shown.text}
      </span>
    </span>
  );
}
