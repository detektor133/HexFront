import { useRef } from 'react';

import styles from './RollNumber.module.css';

/**
 * Число с анимацией смены: основное «прокручивается» по вертикали (вверх при росте, вниз при
 * убыли), предел — другим движением (выезд сбоку со вспышкой). Первая отрисовка без анимации.
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
  const previous = useRef(props.value);
  const turn = useRef(0);
  const direction = useRef<'up' | 'down' | null>(null);
  if (previous.current !== props.value) {
    direction.current = props.value > previous.current ? 'up' : 'down';
    turn.current += 1;
    previous.current = props.value;
  }
  const motion =
    direction.current === null
      ? ''
      : props.kind === 'limit'
        ? styles.limitChange
        : direction.current === 'up'
          ? styles.rollUp
          : styles.rollDown;
  return (
    <span className={`${styles.frame} ${props.className ?? ''}`} title={props.title}>
      <span key={turn.current} className={`${styles.value} ${motion}`}>
        {props.text}
      </span>
    </span>
  );
}
