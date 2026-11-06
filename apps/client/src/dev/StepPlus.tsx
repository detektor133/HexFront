import { IconChevronDown, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import styles from './StepPlus.module.css';
import { STEP_CHOICES, type StepPct } from './army-limit.ts';
import { t } from '../i18n/dict.ts';

/**
 * «Усилить»: нажатие добавляет выбранную долю размера армии, стрелка рядом выбирает долю по
 * умолчанию. Стрелка и плюс — одна кнопка без разделителей.
 */
export function StepPlus(props: {
  readonly step: StepPct;
  readonly onStep: (pct: StepPct) => void;
  readonly onPlus: () => void;
  /** Почему усилить нельзя (кнопка серая); null — можно. */
  readonly disabled: string | null;
  readonly tutorial?: string;
}): React.JSX.Element {
  const { step, onStep, onPlus, disabled } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  return (
    <div ref={ref} className={styles.wrap}>
      <button
        type="button"
        className={styles.plus}
        data-tutorial={props.tutorial}
        disabled={disabled !== null}
        title={disabled ?? `${t('army.stronger')} +${step}%`}
        aria-label={`${t('army.stronger')} +${step}%`}
        onClick={onPlus}
      >
        <IconPlus size={18} aria-hidden="true" />
        <span className={styles.pct}>{step}%</span>
      </button>
      <button
        type="button"
        className={styles.arrow}
        aria-label={t('army.stepChoose')}
        aria-expanded={open}
        title={t('army.stepChoose')}
        onClick={() => setOpen((now) => !now)}
      >
        <IconChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className={styles.list} role="listbox" aria-label={t('army.stepChoose')}>
          {STEP_CHOICES.map((pct) => (
            <li key={pct}>
              <button
                type="button"
                className={pct === step ? styles.itemOn : styles.item}
                role="option"
                aria-selected={pct === step}
                onClick={() => {
                  onStep(pct);
                  setOpen(false);
                }}
              >
                +{pct}%
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
