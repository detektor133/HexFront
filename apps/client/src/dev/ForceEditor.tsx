import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useState } from 'react';

import type { UnitType } from '@hexfront/sim';

import styles from './ForceEditor.module.css';
import { ORDER_TYPES } from './direction-order.ts';
import { countsFromShares, setShare, type Shares } from './force-share.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { t, type MessageKey } from '../i18n/dict.ts';

/**
 * Из чего армия: число солдат (задаётся уровнем на панели армии, здесь только показано) и «Состав»
 * с тремя связанными ползунками долей (пехота, бронетехника, артиллерия), подпись «процент · солдат».
 */
export function ForceEditor(props: {
  readonly total: number;
  readonly shares: Shares;
  readonly onChange: (total: number, shares: Shares) => void;
  /** Игрок отпустил ползунок: значение окончательное — можно применять приказом. */
  readonly onCommit?: (total: number, shares: Shares) => void;
  /** Только состав: без строки «Всего» и кнопки раскрытия, ползунки видны сразу. */
  readonly onlyComposition?: boolean;
}): React.JSX.Element {
  const { total, shares, onChange, onCommit } = props;
  const only = props.onlyComposition === true;
  const commit = (): void => onCommit?.(total, shares);
  const [expanded, setOpen] = useState(false);
  const open = only || expanded;
  const counts = countsFromShares(total, shares);
  const Chevron = open ? IconChevronUp : IconChevronDown;
  return (
    <div className={styles.force}>
      {!only && (
        <div className={styles.head}>
          <span>{t('menu.total')}</span>
          <b className={styles.number}>{total}</b>
        </div>
      )}
      {!only && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          onClick={() => setOpen((now) => !now)}
        >
          {t('menu.composition')}
          <Chevron size={16} aria-hidden="true" />
        </button>
      )}
      {open &&
        ORDER_TYPES.map((type) => (
          <Share
            key={type}
            type={type}
            percent={shares[type]}
            soldiers={counts[type]}
            onChange={(value) => onChange(total, setShare(shares, type, value))}
            onRelease={commit}
          />
        ))}
    </div>
  );
}

function Share(props: {
  readonly type: UnitType;
  readonly percent: number;
  readonly soldiers: number;
  readonly onChange: (percent: number) => void;
  readonly onRelease: () => void;
}): React.JSX.Element {
  const label = t(`unit.${props.type}` as MessageKey);
  return (
    <label className={styles.share}>
      <UnitGlyph className={styles.glyph} type={props.type} />
      <span className={styles.name}>{label}</span>
      <span className={styles.value}>
        {props.percent}% · {props.soldiers}
      </span>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={5}
        value={props.percent}
        aria-label={label}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onPointerUp={props.onRelease}
        onKeyUp={props.onRelease}
      />
    </label>
  );
}
