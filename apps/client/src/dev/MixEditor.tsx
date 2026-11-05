import { useState } from 'react';

import type { UnitType } from '@hexfront/sim';

import styles from './MixEditor.module.css';
import { ORDER_TYPES, setCount, totalOf, type Counts } from './direction-order.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { t, type MessageKey } from '../i18n/dict.ts';

/**
 * Состав приказа: по строке на род войск — значок, название, число (вводится, на телефоне — цифровой
 * клавиатурой) и полоска доли в общем числе. Общий итог — сверху.
 */
export function MixEditor(props: {
  readonly counts: Counts;
  readonly max: number;
  readonly onChange: (counts: Counts) => void;
  readonly onEnter?: () => void;
}): React.JSX.Element {
  const { counts, max, onChange, onEnter } = props;
  const total = totalOf(counts);
  return (
    <div className={styles.mix}>
      <div className={styles.total}>
        <span>{t('menu.total')}</span>
        <b>{total}</b>
      </div>
      {ORDER_TYPES.map((type) => (
        <Row
          key={type}
          type={type}
          value={counts[type]}
          share={total === 0 ? 0 : (100 * counts[type]) / total}
          onChange={(value) => onChange(setCount(counts, type, value, max))}
          {...(onEnter ? { onEnter } : {})}
        />
      ))}
    </div>
  );
}

function Row(props: {
  readonly type: UnitType;
  readonly value: number;
  readonly share: number;
  readonly onChange: (value: number) => void;
  readonly onEnter?: () => void;
}): React.JSX.Element {
  const label = t(`unit.${props.type}` as MessageKey);
  // Поле держит текст, пока его правят: пустое поле не должно мгновенно превращаться в «0».
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className={styles.row}>
      <UnitGlyph className={styles.glyph} type={props.type} />
      <span className={styles.name}>{label}</span>
      <input
        className={styles.input}
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={label}
        value={draft ?? props.value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.target.value);
          props.onChange(Number(event.target.value));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onEnter?.();
        }}
      />
      <span className={styles.bar} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${props.share}%` }} />
      </span>
    </label>
  );
}
