import { IconShield, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import type { Command, MapStatic, PlayerView } from '@hexfront/sim';

import styles from './BorderSignals.module.css';
import { OrderSplit } from './OrderSplit.tsx';
import { autoOrder, contacts, orderArmy } from './army-order.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

/**
 * Сигнал границы: по одной плашке на соседа, с которым появилась общая граница и у которого нет
 * приказа ни одной армии. Висит, пока игрок не закроет крестиком или не нажмёт «Держать ▾».
 */
export function BorderSignals(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly send: (cmd: Command) => void;
}): React.JSX.Element | null {
  const { view, map, send } = props;
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const neighbours = useMemo(() => contacts(view, map), [view, map]);
  const open = [...neighbours]
    .filter(([other]) => !closed.has(other) && !view.armies.some((a) => a.dir?.target === other))
    .sort((a, b) => a[0] - b[0]);
  if (open.length === 0) return null;
  return (
    <div className={styles.stack} role="region" aria-label={t('signal.title')}>
      {open.map(([other, hex]) => (
        <div key={other} className={styles.signal}>
          <span
            className={styles.dot}
            style={{ background: tokens.players.palette[other]?.line ?? tokens.ui.ink }}
          />
          <span className={styles.name}>{view.players[other]?.name ?? other + 1}</span>
          <OrderSplit
            icon={<IconShield size={20} aria-hidden="true" />}
            label="menu.holdShort"
            tutorial="signal-hold"
            disabled={null}
            armies={view.armies}
            onAuto={() => send(autoOrder(view, map, other, 'hold', hex))}
            onPick={(army) => send(orderArmy(view, army, other, 'hold'))}
          />
          <IconButton
            label={t('menu.close')}
            className={styles.close}
            onClick={() => setClosed((now) => new Set(now).add(other))}
          >
            <IconX size={18} aria-hidden="true" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
