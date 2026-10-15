import { useEffect, useRef, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './Leaderboard.module.css';
import { leaderboardRows, type LeaderboardRow } from './leaderboard.ts';
import { t } from '../i18n/dict.ts';
import { formatFp, formatSoldiers } from '../i18n/format.ts';

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
  const rank = me ? rows.indexOf(me) + 1 : '-';
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
            <th scope="col">{t('leaderboard.soldiers')}</th>
            <th scope="col">{t('leaderboard.gold')}</th>
            <th scope="col">{t('leaderboard.score')}</th>
            <th scope="col">{t('leaderboard.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.playerId}
              className={row.status === 'eliminated' ? styles.eliminated : undefined}
            >
              <th scope="row">{row.playerId + 1}</th>
              <td>{row.hexes}</td>
              <td>{row.cities}</td>
              <td>{formatSoldiers(row.soldiers)}</td>
              <td>{formatFp(row.gold)}</td>
              <td>{row.score}</td>
              <td>{t(row.status === 'alive' ? 'leaderboard.alive' : 'leaderboard.eliminated')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
