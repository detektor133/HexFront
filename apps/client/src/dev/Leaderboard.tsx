import { useEffect, useRef, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './Leaderboard.module.css';
import { leaderboardRows, type LeaderboardRow } from './leaderboard.ts';
import { t } from '../i18n/dict.ts';

interface LeaderboardProps {
  readonly view: PlayerView;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly style?: React.CSSProperties | undefined;
}

function useLeaderboard(view: PlayerView): readonly LeaderboardRow[] {
  const latest = useRef(view);
  const [rows, setRows] = useState<readonly LeaderboardRow[]>(() => leaderboardRows(view));
  latest.current = view;

  useEffect(() => {
    setRows(leaderboardRows(view));
  }, [view.ranking, view.players, view.hexes.owner, view.cities]);

  useEffect(() => {
    const timer = window.setInterval(() => setRows(leaderboardRows(latest.current)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return rows;
}

/** Показывает сводку матча и обновляет её раз в секунду. */
export function Leaderboard({
  view,
  open = true,
  onOpenChange = () => undefined,
  style,
}: LeaderboardProps): React.JSX.Element {
  const rows = useLeaderboard(view);
  const me = rows.find((row) => row.playerId === view.playerId);
  const rank = me?.place ?? '-';
  const visibleRows = [...rows].sort((a, b) => a.place - b.place || a.playerId - b.playerId);
  if (!open) {
    return (
      <button
        type="button"
        className={styles.collapsed}
        style={style}
        onClick={() => onOpenChange(true)}
        aria-label={t('leaderboard.title')}
      >
        #{rank} / {rows.length} · {me?.score ?? 0}
      </button>
    );
  }
  return (
    <section className={styles.panel} style={style} aria-label={t('leaderboard.title')}>
      <button type="button" className={styles.collapse} onClick={() => onOpenChange(false)}>
        {t('leaderboard.title')}
      </button>
      <p>
        {t('leaderboard.aliveCount').replace(
          '{count}',
          String(view.players.filter((player) => player.status === 'alive').length),
        )}
      </p>
      <ol
        className={styles.rows}
        aria-label={`${t('leaderboard.place')} / ${t('leaderboard.player')} / ${t('leaderboard.score')}`}
      >
        {visibleRows.slice(0, 5).map((row) => (
          <li className={styles.row} key={row.playerId} role="row">
            <span className={styles.place} role="rowheader">
              {row.place}
            </span>
            <span className={styles.player} role="cell">
              {view.players[row.playerId]?.name ?? `${t('observer.player')} ${row.playerId + 1}`}
            </span>
            <span className={styles.score} role="cell">
              {row.score}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
