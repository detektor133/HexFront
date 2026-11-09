import { IconChevronUp, IconTrophy } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './Leaderboard.module.css';
import {
  countryHex,
  leaderboardRows,
  sortLeaderboardRows,
  type LeaderboardRow,
} from './leaderboard.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';

interface LeaderboardProps {
  readonly view: PlayerView;
  /** Клик по стране: камера идёт к её столице или видимой земле. */
  readonly onPick?: (hex: number) => void;
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
  onPick,
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
      const entry = entries[0];
      const borderBox = entry?.borderBoxSize?.[0];
      const style = getComputedStyle(panel);
      const px = (value: string): number => Number.parseFloat(value) || 0;
      const rect = borderBox
        ? { width: borderBox.inlineSize, height: borderBox.blockSize }
        : entry
          ? {
              width:
                entry.contentRect.width +
                px(style.paddingLeft) +
                px(style.paddingRight) +
                px(style.borderLeftWidth) +
                px(style.borderRightWidth),
              height:
                entry.contentRect.height +
                px(style.paddingTop) +
                px(style.paddingBottom) +
                px(style.borderTopWidth) +
                px(style.borderBottomWidth),
            }
          : panel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) onSize({ width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(panel, { box: 'border-box' });
    return () => observer.disconnect();
  }, [onSize]);
  const me = rows.find((row) => row.playerId === view.playerId);
  const rank = me?.place ?? '-';
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
  // Каждое место занимает один игрок (равные очки решают города и земля); свой ряд виден всегда.
  const sorted = sortLeaderboardRows(rows);
  const shown = sorted.slice(0, 5).map((row, index) => ({ row, place: index + 1 }));
  const mineIndex = sorted.findIndex((row) => row.playerId === view.playerId);
  const mine = sorted[mineIndex];
  const alive = t('leaderboard.aliveCount').replace(
    '{count}',
    String(view.players.filter((player) => player.status === 'alive').length),
  );
  if (mine && mineIndex >= 5) shown.push({ row: mine, place: mineIndex + 1 });
  return (
    <section
      ref={panelRef}
      className={styles.panel}
      style={style}
      aria-label={t('leaderboard.title')}
    >
      <h2 className={styles.title}>
        {isDesktopViewport() ? (
          <>
            <IconTrophy size={16} aria-hidden="true" />
            <span>{t('leaderboard.title')}</span>
            <span className={styles.alive}>{alive}</span>
          </>
        ) : (
          // Телефон: заголовок — кнопка, второе нажатие сворачивает таблицу обратно в метку.
          <button
            type="button"
            className={styles.fold}
            aria-expanded="true"
            aria-label={t('leaderboard.collapse')}
            onClick={() => onOpenChange(false)}
          >
            <IconTrophy size={16} aria-hidden="true" />
            <span>{t('leaderboard.title')}</span>
            <span className={styles.alive}>{alive}</span>
            <IconChevronUp size={16} aria-hidden="true" />
          </button>
        )}
      </h2>
      <ol
        className={styles.rows}
        aria-label={`${t('leaderboard.place')} / ${t('leaderboard.player')} / ${t('leaderboard.score')}`}
      >
        {shown.map(({ row, place }) => {
          const name =
            view.players[row.playerId]?.name ?? `${t('observer.player')} ${row.playerId + 1}`;
          const hex = countryHex(view, row.playerId);
          const color = tokens.players.palette[row.playerId]?.line ?? tokens.ui.ink;
          const eliminated = view.players[row.playerId]?.status === 'eliminated';
          return (
            <li key={row.playerId}>
              <button
                type="button"
                className={`${styles.row} ${row.playerId === view.playerId ? styles.mine : ''} ${eliminated ? styles.eliminated : ''}`}
                disabled={hex === null || !onPick}
                title={name}
                onClick={() => {
                  if (hex !== null) onPick?.(hex);
                }}
              >
                <span className={styles.place}>{place}</span>
                <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
                <span className={styles.player}>{name}</span>
                <span className={styles.score}>{row.score}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
