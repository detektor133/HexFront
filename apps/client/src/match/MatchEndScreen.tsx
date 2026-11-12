import { useState } from 'react';

import type { WinReason } from '@hexfront/sim';

import styles from './MatchEndScreen.module.css';
import { t } from '../i18n/dict.ts';
import { formatFp, formatSoldiers } from '../i18n/format.ts';
import tv from '../ui/tv-window.module.css';

interface VictoryHoldView {
  readonly player: number;
  readonly seconds: number;
}

/** Строка таблицы итогов: место, имя и очки игрока. */
export interface EndRow {
  readonly id: number;
  readonly name: string;
  readonly place: number;
  readonly score: number;
}

/** Статистика игрока на конец матча. */
export interface EndStats {
  readonly hexes: number;
  readonly cities: number;
  readonly score: number;
}

export interface MatchEndScreenProps {
  readonly soldiers: number;
  readonly gold: number;
  readonly winner: number;
  readonly playerId: number;
  readonly playerName?: string;
  readonly winnerName?: string;
  readonly place: number;
  readonly eliminated: boolean;
  readonly fog: boolean;
  readonly reason?: WinReason;
  /** Союзники победителя при победе коалиции. */
  readonly allies?: readonly number[];
  readonly victoryHold?: VictoryHoldView | null;
  readonly rows?: readonly EndRow[];
  readonly stats?: EndStats;
  readonly onWatch: (message: { readonly type: 'setFog'; readonly enabled: boolean }) => void;
  readonly onMenu: (path: string) => void;
}

function victoryReason(reason: WinReason | undefined): string {
  if (reason === 'cities') return t('match.reason.cities');
  if (reason === 'allCities') return t('match.reason.allCities');
  if (reason === 'coalition') return t('match.reason.coalition');
  return t('match.reason.lastStanding');
}

// Заголовок и пояснение: победа, поражение (победил другой) или выбывание.
function heading(props: MatchEndScreenProps): React.JSX.Element[] {
  if (props.eliminated) {
    return [
      <h2 key="title" className={styles.title}>
        {t('match.eliminated')}
      </h2>,
      <p key="reason" className={styles.reason}>
        {`${t('match.placeLower')} ${props.place}`}
      </p>,
    ];
  }
  const won = props.winner === props.playerId || (props.allies?.includes(props.playerId) ?? false);
  const who = props.winnerName ?? `${t('observer.player')} ${props.winner + 1}`;
  const text = won
    ? victoryReason(props.reason)
    : `${t('match.winnerIs')}: ${who} · ${victoryReason(props.reason)}`;
  return [
    <h2 key="title" className={styles.title}>
      {won ? t('match.won') : t('match.lost')}
    </h2>,
    <p key="reason" className={styles.reason}>
      {text}
    </p>,
  ];
}

function standings(props: MatchEndScreenProps): React.JSX.Element | null {
  const rows = props.rows;
  if (!rows || rows.length === 0) return null;
  return (
    <ol key="table" className={styles.table} aria-label={t('match.standings')}>
      {rows.map((r) => (
        <li
          key={r.id}
          className={r.id === props.playerId ? `${styles.row} ${styles.me}` : styles.row}
        >
          <span className={styles.place}>{r.place}</span>
          <span>{r.name}</span>
          <span>{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

function statistics(props: MatchEndScreenProps): React.JSX.Element {
  const items: readonly (readonly [string, string])[] = [
    [t('match.statHexes'), String(props.stats?.hexes ?? 0)],
    [t('match.statCities'), String(props.stats?.cities ?? 0)],
    [t('match.statSoldiers'), formatSoldiers(props.soldiers)],
    [t('match.statGold'), formatFp(props.gold)],
  ];
  return (
    <dl key="stats" className={styles.stats}>
      {items.map(([name, value]) => (
        <div key={name} className={styles.stat}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MatchEndScreen(props: MatchEndScreenProps): React.JSX.Element | null {
  const [watching, setWatching] = useState(false);
  if (watching || (props.winner < 0 && !props.eliminated)) return null;
  const ended = props.eliminated || props.winner >= 0;
  return (
    <section className={`${styles.card} ${tv.on}`} role="dialog" aria-label={t('match.end')}>
      {[
        ...(ended ? heading(props) : []),
        ...(ended ? [standings(props), statistics(props)] : []),
        ...(props.eliminated
          ? [
              <button
                key="watch"
                type="button"
                className={styles.button}
                onClick={() => {
                  props.onWatch({ type: 'setFog', enabled: false });
                  setWatching(true);
                }}
              >
                {t('match.observe')}
              </button>,
            ]
          : []),
        ...(ended
          ? [
              <button
                key="menu"
                type="button"
                className={styles.primary}
                onClick={() => props.onMenu('/')}
              >
                {t('pause.menu')}
              </button>,
            ]
          : []),
      ]}
    </section>
  );
}
