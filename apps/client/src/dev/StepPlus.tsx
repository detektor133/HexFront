import { IconChevronDown, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { FP } from '@hexfront/sim';

import styles from './StepPlus.module.css';
import { STEP_CHOICES, type StepPct } from './army-limit.ts';
import { t } from '../i18n/dict.ts';
import { formatCompact } from '../i18n/format.ts';
import { GoldIcon } from '../ui/gold-icon.tsx';

/** Сколько висит облачко с пределом, мс (совпадает с анимацией в CSS). */
const BUBBLE_MS = 1700;

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
  /** Золото, которого стоит нажатие (докупка недостающих солдат); мелко под процентом. */
  readonly cost?: number | undefined;
  /** Лимит армии после нажатия и предел государства, солдат: облачко над кнопкой после нажатия. */
  readonly limit?: { readonly next: number; readonly max: number } | undefined;
}): React.JSX.Element {
  const { step, onStep, onPlus, disabled } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Облачко с пределом армии: каждое нажатие показывает его заново и оно гаснет само.
  // Значения запоминаются в момент нажатия: после ответа матча кнопка уже считает следующий шаг.
  const [bubble, setBubble] = useState<{
    readonly id: number;
    readonly next: number;
    readonly max: number;
  } | null>(null);
  const bubbleId = useRef(0);
  useEffect(() => {
    if (bubble === null) return;
    const timer = window.setTimeout(() => setBubble(null), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [bubble]);
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
        title={disabled ?? `${t('army.stronger')} +${step}%${props.cost ? ` · ${props.cost}` : ''}`}
        aria-label={`${t('army.stronger')} +${step}%`}
        onClick={() => {
          onPlus();
          if (props.limit) {
            bubbleId.current += 1;
            setBubble({ id: bubbleId.current, ...props.limit });
          }
        }}
      >
        <span className={styles.top}>
          <IconPlus size={18} aria-hidden="true" />
          <span className={styles.pct}>{step}%</span>
        </span>
        {props.cost ? (
          <span className={styles.cost}>
            <GoldIcon />
            {props.cost}
          </span>
        ) : null}
      </button>
      {bubble !== null && (
        <span key={bubble.id} className={styles.bubble} role="status">
          <span className={styles.bubbleLabel}>{t('army.limitMax')}</span>
          <span className={styles.bubbleValue}>
            {formatCompact(bubble.next * FP)}
            <span className={styles.bubbleMax}>{'/ ' + formatCompact(bubble.max * FP)}</span>
          </span>
        </span>
      )}
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
