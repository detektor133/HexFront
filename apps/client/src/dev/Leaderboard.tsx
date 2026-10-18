import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './Leaderboard.module.css';
import { leaderboardRows, sortLeaderboardRows, type LeaderboardRow } from './leaderboard.ts';
import { t } from '../i18n/dict.ts';

interface LeaderboardProps {
  readonly view: PlayerView;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly style?: React.CSSProperties | undefined;
  readonly onSize?: (size: { readonly width: number; readonly height: number }) => void;
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

function isDesktopViewport(): boolean {
  return window.innerWidth > 600;
}

/** Показывает сводку матча и обновляет её раз в секунду. */
export function Leaderboard({
  view,
  open = true,
  onOpenChange = () => undefined,
  style,
  onSize,
}: LeaderboardProps): React.JSX.Element {
  const rows = useLeaderboard(view);
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onSize) return;
    const report = (entries: readonly ResizeObserverEntry[] = []): void => {
      const observedRect = entries[0]?.contentRect;
      const rect = observedRect ?? panel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) onSize({ width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [onSize]);
  const me = rows.find((row) => row.playerId === view.playerId);
  const rank = me?.place ?? '-';
  const visibleRows = sortLeaderboardRows(rows).slice(0, 5);
  if (!open && !isDesktopViewport()) {
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
  const displayedPlaces = new Map<number, number>();
  visibleRows.forEach((row, index) => {
    const previous = visibleRows[index - 1];
    displayedPlaces.set(
      row.playerId,
      previous?.score === row.score ? (displayedPlaces.get(previous.playerId) ?? 1) : index + 1,
    );
  });
  return (
    <section
      ref={panelRef}
      className={styles.panel}
      style={style}
      aria-label={t('leaderboard.title')}
    >
      <h2 className={styles.title}>{t('leaderboard.title')}</h2>
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
              {displayedPlaces.get(row.playerId) ?? row.place}
            </span>
            <span
              className={styles.player}
              role="cell"
              title={
                view.players[row.playerId]?.name ?? `${t('observer.player')} ${row.playerId + 1}`
              }
            >
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
