import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './ArmyLimit.module.css';
import { ForceEditor } from './ForceEditor.tsx';
import { hireEstimate } from './army-limit.ts';
import type { Counts } from './direction-order.ts';
import { countsFromShares, type Shares } from './force-share.ts';
import { t } from '../i18n/dict.ts';

const WIDTH = 248;
const EDGE = 8;

/** Поповер армии над карточкой: сколько войск и из чего (ползунки); применяется сразу, как отпустил ползунок. */
export function ArmyLimit(props: {
  /** Прямоугольник кнопки лимита на карточке, px страницы. */
  readonly anchor: DOMRect;
  readonly value: number;
  readonly shares: Shares;
  /** Солдаты армии по типам, уже стоящие в отрядах. */
  readonly have: Counts;
  /** Золото игрока, целое. */
  readonly gold: number;
  readonly onApply: (soldiers: number, counts: Counts) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { anchor, onApply, onClose } = props;
  const [force, setForce] = useState({ total: props.value, shares: props.shares });
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - WIDTH - EDGE));
  return createPortal(
    <div
      ref={ref}
      className={styles.pop}
      style={{
        left,
        bottom: window.innerHeight - anchor.top + 8,
        width: WIDTH,
        maxHeight: Math.max(120, anchor.top - 8 - 56),
      }}
      role="dialog"
      aria-label={t('army.composition')}
    >
      <ForceEditor
        onlyComposition
        total={force.total}
        shares={force.shares}
        onChange={(total, shares) => setForce({ total, shares })}
        onCommit={(total, shares) => onApply(total, countsFromShares(total, shares))}
      />
      <HireLine have={props.have} gold={props.gold} total={force.total} shares={force.shares} />
    </div>,
    document.body,
  );
}

// Сколько людей и золота уйдёт на найм при выбранном составе: цена видна до того, как отпустил ползунок.
function HireLine(props: {
  readonly have: Counts;
  readonly gold: number;
  readonly total: number;
  readonly shares: Shares;
}): React.JSX.Element {
  const hire = hireEstimate(props.have, countsFromShares(props.total, props.shares));
  if (hire.soldiers === 0) return <p className={styles.hire}>{t('army.hireNone')}</p>;
  const text = t('army.hire')
    .replace('{soldiers}', String(hire.soldiers))
    .replace('{gold}', String(hire.gold));
  return (
    <p className={`${styles.hire} ${hire.gold > props.gold ? styles.hireWarn : ''}`}>{text}</p>
  );
}
