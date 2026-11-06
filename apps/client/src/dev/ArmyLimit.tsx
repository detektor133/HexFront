import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './ArmyLimit.module.css';
import { ForceEditor } from './ForceEditor.tsx';
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
      style={{ left, bottom: window.innerHeight - anchor.top + 8, width: WIDTH }}
      role="dialog"
      aria-label={t('army.limit')}
    >
      <ForceEditor
        total={force.total}
        shares={force.shares}
        onChange={(total, shares) => setForce({ total, shares })}
        onCommit={(total, shares) => onApply(total, countsFromShares(total, shares))}
      />
    </div>,
    document.body,
  );
}
