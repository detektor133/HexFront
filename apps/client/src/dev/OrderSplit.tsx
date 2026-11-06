import { IconChevronDown } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import type { ArmyView } from '@hexfront/sim';

import styles from './OrderSplit.module.css';
import { armyName } from './army-name.ts';
import { isFree } from './army-order.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { armyColor } from '../theme/colors.ts';
import { GoldIcon } from '../ui/gold-icon.tsx';

/**
 * Кнопка приказа со стрелкой вниз: основная часть отдаёт приказ автоподбором армии, стрелка
 * открывает список армий, чтобы выбрать вручную (приказ занятой армии заменяется). Один шаблон для
 * сигнала границы и меню страны.
 */
export function OrderSplit(props: {
  readonly icon: React.ReactNode;
  readonly label: MessageKey;
  /** Почему приказ недоступен (кнопка серая); null — доступен. */
  readonly disabled: string | null;
  readonly armies: readonly ArmyView[];
  readonly onAuto: () => void;
  readonly onPick: (army: ArmyView) => void;
  readonly tutorial?: string;
  /** «Призрак»: фон и рамка как у кнопок панели, без заливки цветом; по умолчанию — заливка. */
  readonly tone?: 'fill' | 'ghost';
  /** Золото на набор новой армии: мелким шрифтом под подписью; нет — армия уже есть. */
  readonly cost?: number | null | undefined;
  /** Малый вид: только значок и стрелка. */
  readonly compact?: boolean;
}): React.JSX.Element {
  const { icon, label, disabled, armies, onAuto, onPick } = props;
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
    <div
      ref={ref}
      className={`${styles.split} ${props.compact ? styles.compact : ''} ${props.tone === 'ghost' ? styles.ghost : ''} ${props.cost ? styles.withCost : ''}`}
    >
      <button
        type="button"
        className={styles.main}
        data-tutorial={props.tutorial}
        disabled={disabled !== null}
        title={disabled ?? t(label)}
        onClick={onAuto}
      >
        {props.cost ? (
          <span className={styles.stack}>
            <span className={styles.line}>
              {icon}
              {!props.compact && <span>{t(label)}</span>}
            </span>
            <span className={styles.cost} title={t('order.cost')}>
              <GoldIcon />
              {props.cost}
            </span>
          </span>
        ) : (
          <>
            {icon}
            {!props.compact && <span>{t(label)}</span>}
          </>
        )}
      </button>
      <button
        type="button"
        className={styles.arrow}
        aria-label={t('order.pickArmy')}
        aria-expanded={open}
        disabled={armies.length === 0}
        title={t('order.pickArmy')}
        onClick={() => setOpen((now) => !now)}
      >
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className={styles.list} role="listbox" aria-label={t('order.pickArmy')}>
          {armies.map((army) => (
            <li key={army.id}>
              <button
                type="button"
                className={styles.item}
                role="option"
                aria-selected={false}
                onClick={() => {
                  setOpen(false);
                  onPick(army);
                }}
              >
                <span className={styles.swatch} style={{ background: armyColor(army.number) }} />
                <span className={styles.itemName}>{armyName(army)}</span>
                {!isFree(army) && <span className={styles.busy} title={t('order.busy')} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
