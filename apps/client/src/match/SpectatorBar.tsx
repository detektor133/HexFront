import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import type { PlayerView } from '@hexfront/sim';

import styles from './SpectatorBar.module.css';
import { t } from '../i18n/dict.ts';

export interface SpectatorBarProps {
  readonly view: PlayerView;
  readonly onWatch: (player: number) => void;
  readonly style?: React.CSSProperties;
}

/** Живые игроки по месту в таблице: по ним листает панель наблюдателя. */
export function watchOrder(view: PlayerView): number[] {
  const alive = new Set(view.players.filter((p) => p.status === 'alive').map((p) => p.id));
  const ranked = [...(view.ranking ?? [])]
    .sort((a, b) => a.place - b.place || a.id - b.id)
    .map((r) => r.id)
    .filter((id) => alive.has(id));
  const rest = [...alive].filter((id) => !ranked.includes(id)).sort((a, b) => a - b);
  return [...ranked, ...rest];
}

/** Сосед в круге наблюдения: `step` +1 — следующий, −1 — предыдущий. */
export function neighbour(order: readonly number[], current: number, step: 1 | -1): number | null {
  if (order.length === 0) return null;
  const at = order.indexOf(current);
  if (at < 0) return step === 1 ? (order[0] ?? null) : (order[order.length - 1] ?? null);
  return order[(at + step + order.length) % order.length] ?? null;
}

/** Панель выбывшего игрока: чьими глазами идёт матч; действий в этом виде нет. */
export function SpectatorBar(props: SpectatorBarProps): React.JSX.Element {
  const { view } = props;
  const order = watchOrder(view);
  const name = view.players[view.playerId]?.name ?? `${t('observer.player')} ${view.playerId + 1}`;
  const go = (step: 1 | -1): void => {
    const next = neighbour(order, view.playerId, step);
    if (next !== null && next !== view.playerId) props.onWatch(next);
  };
  return (
    <section
      className={styles.bar}
      style={props.style}
      role="group"
      aria-label={t('spectator.title')}
    >
      <button
        type="button"
        className={styles.arrow}
        aria-label={t('spectator.prev')}
        title={t('spectator.prev')}
        onClick={() => go(-1)}
      >
        <IconChevronLeft size={20} aria-hidden="true" />
      </button>
      <p className={styles.name} role="status">
        <span className={styles.label}>{t('spectator.watching')}</span>
        <span>{name}</span>
      </p>
      <button
        type="button"
        className={styles.arrow}
        aria-label={t('spectator.next')}
        title={t('spectator.next')}
        onClick={() => go(1)}
      >
        <IconChevronRight size={20} aria-hidden="true" />
      </button>
    </section>
  );
}
