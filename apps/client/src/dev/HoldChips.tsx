import { IconShieldOff, IconUsersGroup } from '@tabler/icons-react';

import type { ArmyView } from '@hexfront/sim';

import styles from './HoldChips.module.css';
import { armyName } from './army-name.ts';
import { t } from '../i18n/dict.ts';
import { armyColor } from '../theme/colors.ts';

/**
 * Армии, которые держат страну, — в одну строку фишками: цвет и номер (клик выбирает армию на
 * карте), значок «группа» у армии на весь альянс, рядом значок «снять с фронта». Без выпадающих
 * списков: управление видно сразу, а окно растёт не больше чем на одну строку.
 */
export function HoldChips(props: {
  readonly holders: readonly ArmyView[];
  readonly onSelect: (armyId: number) => void;
  readonly onRelease: (armyId: number) => void;
}): React.JSX.Element | null {
  const { holders, onSelect, onRelease } = props;
  if (holders.length === 0) return null;
  return (
    <div className={styles.row} role="group" aria-label={t('order.holding')}>
      {holders.map((army) => {
        const bloc = army.dir?.bloc === true;
        const title = `${armyName(army)} · ${bloc ? t('order.scopeBloc') : t('order.scopeOne')}`;
        return (
          <span key={army.id} className={styles.chip}>
            <button
              type="button"
              className={styles.pick}
              title={title}
              aria-label={title}
              onClick={() => onSelect(army.id)}
            >
              <span className={styles.dot} style={{ background: armyColor(army.number) }} />
              <span>{army.number}</span>
              {bloc && <IconUsersGroup size={14} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={styles.drop}
              title={t('menu.unfront')}
              aria-label={`${t('menu.unfront')}: ${armyName(army)}`}
              onClick={() => onRelease(army.id)}
            >
              <IconShieldOff size={14} aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
