// Число кнопками «−» и «+» и вводом с клавиатуры: боты, игроки.
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';

import styles from './stepper.module.css';

export interface StepperProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly onChange: (value: number) => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Выбор числа: ввод принимается по уходу из поля или Enter, всегда в пределах [min, max]. */
export function Stepper(props: StepperProps): React.JSX.Element {
  const { value, min, max } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const parsed = Math.floor(Number(draft));
    setDraft(null);
    if (Number.isFinite(parsed) && draft.trim() !== '') props.onChange(clamp(parsed, min, max));
  };
  return (
    <div className={styles.stepper} role="group" aria-label={props.label}>
      <button
        type="button"
        className={styles.button}
        aria-label={`${props.label} −`}
        disabled={value <= min}
        onClick={() => props.onChange(clamp(value - 1, min, max))}
      >
        <IconMinus size={18} aria-hidden="true" />
      </button>
      <input
        className={styles.input}
        inputMode="numeric"
        aria-label={props.label}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 3))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      <button
        type="button"
        className={styles.button}
        aria-label={`${props.label} +`}
        disabled={value >= max}
        onClick={() => props.onChange(clamp(value + 1, min, max))}
      >
        <IconPlus size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
