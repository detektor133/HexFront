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
  const visibleRows = rows
    .filter((row) => row.place <= 5 || row.playerId === view.playerId)
    .sort((a, b) => a.place - b.place || a.playerId - b.playerId);
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
      <h2>{t('leaderboard.title')}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('leaderboard.player')}</th>
            <th scope="col">{t('leaderboard.hexes')}</th>
            <th scope="col">{t('leaderboard.cities')}</th>
            <th scope="col">{t('leaderboard.score')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.playerId}>
              <th scope="row">{row.place}</th>
              <td>{row.hexes}</td>
              <td>{row.cities}</td>
              <td>{row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
