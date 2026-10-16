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
      <table>
        <thead>
          <tr>
            <th scope="col">{t('leaderboard.place')}</th>
            <th scope="col">{t('leaderboard.player')}</th>
            <th scope="col">{t('leaderboard.score')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.slice(0, 5).map((row) => (
            <tr key={row.playerId}>
              <th scope="row">{row.place}</th>
              <td>
                {view.players[row.playerId]?.name ?? `${t('observer.player')} ${row.playerId + 1}`}
              </td>
              <td>{row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
