import { IconCheck, IconMinus, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import styles from './ArmyLimit.module.css';
import { LIMIT_STEP, clampLimit, presetAmount } from './army-limit.ts';
import { t } from '../i18n/dict.ts';
import { IconButton } from '../ui/icon-button.tsx';

const PRESETS: readonly { readonly label: string; readonly share: number }[] = [
  { label: '25%', share: 0.25 },
  { label: '50%', share: 0.5 },
  { label: '75%', share: 0.75 },
  { label: '100%', share: 1 },
];
const WIDTH = 224;
const EDGE = 8;

/** Число солдат: большое поле, −/+ и доли предела; общий для карточки армии и окна соседа. */
export function LimitEditor(props: {
  readonly value: number;
  readonly max: number;
  readonly onChange: (soldiers: number) => void;
  readonly onEnter?: () => void;
}): React.JSX.Element {
  const { value, max, onChange, onEnter } = props;
  const change = (next: number): void => onChange(clampLimit(next, max));
  return (
    <>
      <div className={styles.value}>
        <IconButton label="−" className={styles.step} onClick={() => change(value - LIMIT_STEP)}>
          <IconMinus size={18} aria-hidden="true" />
        </IconButton>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          aria-label={t('army.limit')}
          onChange={(event) => change(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEnter?.();
          }}
        />
        <IconButton label="+" className={styles.step} onClick={() => change(value + LIMIT_STEP)}>
          <IconPlus size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={value === presetAmount(max, p.share) ? styles.presetOn : styles.preset}
            onClick={() => change(presetAmount(max, p.share))}
          >
            {p.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Мини-поповер лимита армии над карточкой: число, −/+ и доли предела; применяется кнопкой ✓. */
export function ArmyLimit(props: {
  /** Прямоугольник кнопки лимита на карточке, px страницы. */
  readonly anchor: DOMRect;
  readonly value: number;
  readonly max: number;
  readonly onApply: (soldiers: number) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { anchor, max, onApply, onClose } = props;
  const [value, setValue] = useState(props.value);
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
  const set = (next: number): void => setValue(clampLimit(next, max));
  const apply = (): void => {
    onApply(value);
    onClose();
  };
  return createPortal(
    <div
      ref={ref}
      className={styles.pop}
      style={{ left, bottom: window.innerHeight - anchor.top + 8, width: WIDTH }}
      role="dialog"
      aria-label={t('army.limit')}
    >
      <LimitEditor value={value} max={max} onChange={set} onEnter={apply} />
      <button type="button" className={styles.okWide} onClick={apply}>
        <IconCheck size={18} aria-hidden="true" />
        {t('army.limitApply')}
      </button>
    </div>,
    document.body,
  );
}
