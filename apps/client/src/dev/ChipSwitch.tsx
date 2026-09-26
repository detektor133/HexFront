import styles from './ArmyBar.module.css';
import { CHIP_STYLES, type ChipStyle } from './unit-chips.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';

/** Строка легенды: образец цвета и подпись. */
function Key(props: { color: string; shape: 'bar' | 'box' | 'warn'; label: MessageKey }) {
  const cls =
    props.shape === 'bar' ? styles.keyBar : props.shape === 'box' ? styles.keyBox : styles.keyWarn;
  const style =
    props.shape === 'warn' ? { borderBottomColor: props.color } : { background: props.color };
  return (
    <span className={styles.key}>
      <span className={cls} style={style} />
      {t(props.label)}
    </span>
  );
}

/**
 * Переключатель вида фишки (CR-004) и легенда: что значат цвета и столбики. Владелец выбирает
 * вариант, потом лишние уберём.
 */
export function ChipSwitch(props: {
  value: ChipStyle;
  onChange: (s: ChipStyle) => void;
}): React.JSX.Element {
  return (
    <div className={styles.chipSwitch} role="group" aria-label={t('chip.style')}>
      <span className={styles.buttons}>
        <span>{t('chip.style')}:</span>
        {CHIP_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.small}
            aria-pressed={s === props.value}
            onClick={() => props.onChange(s)}
          >
            {t(`chip.${s}`)}
          </button>
        ))}
      </span>
      <span className={styles.legend}>
        <Key shape="box" color={tokens.relation.own} label="legend.own" />
        <Key shape="box" color={tokens.relation.enemy} label="legend.enemy" />
        <Key shape="bar" color={tokens.armies.palette[0] ?? tokens.ui.ink} label="legend.army" />
        <Key shape="bar" color={tokens.chip.org} label="legend.org" />
        <Key shape="bar" color={tokens.chip.supply} label="legend.supply" />
        <Key shape="warn" color={tokens.status.lowSupply} label="legend.warn" />
      </span>
    </div>
  );
}
