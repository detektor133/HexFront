import styles from './ArmyBar.module.css';
import { CHIP_STYLES, type ChipStyle } from './unit-chips.ts';
import { t } from '../i18n/dict.ts';

/** Переключатель вида фишки (CR-003): владелец выбирает вариант, потом лишние уберём. */
export function ChipSwitch(props: {
  value: ChipStyle;
  onChange: (s: ChipStyle) => void;
}): React.JSX.Element {
  return (
    <div className={styles.chipSwitch} role="group" aria-label={t('chip.style')}>
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
    </div>
  );
}
