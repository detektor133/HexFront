import {
  IconChevronDown,
  IconPlus,
  IconShieldOff,
  IconUser,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import type { ArmyView, Command, MapStatic, PlayerView } from '@hexfront/sim';

import styles from './HoldSplit.module.css';
import { armyName } from './army-name.ts';
import { autoArmy, isFree, orderArmy, orderNewArmy } from './army-order.ts';
import { t } from '../i18n/dict.ts';
import { armyColor } from '../theme/colors.ts';
import { GoldIcon } from '../ui/gold-icon.tsx';

/**
 * «Держат» у страны, границу которой уже держит армия: одна компактная кнопка — цвет и имя армии
 * (клик выбирает её на карте), рядом счётчик, если армий несколько. Стрелка открывает список поверх
 * окна: сверху держащие армии со значком «весь альянс» или «только эта» и значком снять с фронта,
 * ниже — остальные армии и «Новая»: они добавляются к фронту, а не заменяют его (усиление).
 */
export function HoldSplit(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly other: number;
  readonly hex: number;
  readonly holders: readonly ArmyView[];
  readonly send: (cmd: Command) => void;
  readonly onSelectArmy?: ((armyId: number) => void) | undefined;
}): React.JSX.Element | null {
  const { view, map, other, hex, holders, send, onSelectArmy } = props;
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
  const first = holders[0];
  if (!first) return null;
  const holderIds = new Set(holders.map((a) => a.id));
  const spare = view.armies.filter((a) => !holderIds.has(a.id));
  const fresh = autoArmy(view, map, other, hex);
  const freshCost = fresh.kind === 'new' ? fresh.cost : null;
  const scopeIcon = (army: ArmyView): React.JSX.Element =>
    army.dir?.bloc === true ? (
      <IconUsersGroup size={16} aria-label={t('order.scopeBloc')} className={styles.scope} />
    ) : (
      <IconUser size={16} aria-label={t('order.scopeOne')} className={styles.scope} />
    );
  return (
    <div ref={ref} className={styles.split}>
      <button
        type="button"
        className={styles.main}
        data-tutorial="hold"
        title={t('order.holder')}
        onClick={() => onSelectArmy?.(first.id)}
      >
        <span className={styles.dot} style={{ background: armyColor(first.number) }} />
        <span className={styles.name}>{armyName(first)}</span>
        {scopeIcon(first)}
        {holders.length > 1 && <span className={styles.more}>+{holders.length - 1}</span>}
      </button>
      <button
        type="button"
        className={styles.arrow}
        aria-label={t('order.pickArmy')}
        aria-expanded={open}
        title={t('order.pickArmy')}
        onClick={() => setOpen((now) => !now)}
      >
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul className={styles.list} role="listbox" aria-label={t('order.pickArmy')}>
          <li className={styles.title}>{t('order.holding')}</li>
          {holders.map((army) => (
            <li key={army.id} className={styles.row}>
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  onSelectArmy?.(army.id);
                }}
              >
                <span className={styles.dot} style={{ background: armyColor(army.number) }} />
                <span className={styles.name}>{armyName(army)}</span>
                <span className={styles.tag}>
                  {army.dir?.bloc === true ? t('order.scopeBloc') : t('order.scopeOne')}
                </span>
              </button>
              <button
                type="button"
                className={styles.drop}
                aria-label={t('menu.unfront')}
                title={t('menu.unfront')}
                onClick={() => {
                  setOpen(false);
                  send({ t: 'holdBorder', target: other, soldiers: 0, armyId: army.id });
                }}
              >
                <IconShieldOff size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li className={styles.title}>{t('order.addArmy')}</li>
          {spare.map((army) => (
            <li key={army.id}>
              <button
                type="button"
                className={styles.item}
                onClick={() => {
                  setOpen(false);
                  send(orderArmy(view, army, other, 'hold'));
                }}
              >
                <span className={styles.dot} style={{ background: armyColor(army.number) }} />
                <span className={styles.name}>{armyName(army)}</span>
                {!isFree(army) && <span className={styles.tag}>{t('order.busy')}</span>}
                <IconPlus size={16} aria-hidden="true" className={styles.scope} />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                send(orderNewArmy(view, map, other, 'hold'));
              }}
            >
              <span className={styles.name}>{t('order.newArmy')}</span>
              {freshCost !== null && (
                <span className={styles.tag}>
                  <GoldIcon />
                  {freshCost}
                </span>
              )}
              <IconPlus size={16} aria-hidden="true" className={styles.scope} />
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
