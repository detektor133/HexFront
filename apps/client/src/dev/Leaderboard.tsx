import { useEffect, useRef, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './Leaderboard.module.css';
import { leaderboardRows, type LeaderboardRow } from './leaderboard.ts';
import { t } from '../i18n/dict.ts';
import { formatFp, formatSoldiers } from '../i18n/format.ts';

interface LeaderboardProps {
  readonly view: PlayerView;
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
export function Leaderboard({ view }: LeaderboardProps): React.JSX.Element {
  const rows = useLeaderboard(view);
  return (
    <section className={styles.panel} aria-label={t('leaderboard.title')}>
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
