import { useEffect, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './MatchEnd.module.css';
import { matchEnd, matchStatistics, replayFrames, type MatchStatistics } from './match-end.ts';
import { t } from '../i18n/dict.ts';

/** Карточка «Конец матча» (07-controls.md, «Экраны MVP», п. 4, упрощённо): итог, место, «Ещё раз». */
function Replay({ frames }: { readonly frames: readonly PlayerView[] }): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return undefined;
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % frames.length),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [frames.length]);
  const owners = frames[frame]?.hexes.owner ?? new Int16Array();
  return (
    <section className={styles.replay} aria-label={t('match.replay')}>
      <h3 className={styles.subtitle}>{t('match.replay')}</h3>
      <div className={styles.replayMap} aria-label={`${t('match.replayFrame')} ${frame + 1}`}>
        {Array.from(owners, (owner, index) => (
          <span key={index} className={styles.hex} data-owner={owner} />
        ))}
      </div>
      <progress className={styles.progress} max={Math.max(frames.length - 1, 1)} value={frame} />
    </section>
  );
}

function Statistics({ stats }: { readonly stats: MatchStatistics }): React.JSX.Element {
  return (
    <dl className={styles.stats}>
      <div>
        <dt>{t('match.hexes')}</dt>
        <dd>{stats.hexes}</dd>
      </div>
      <div>
        <dt>{t('match.cities')}</dt>
        <dd>{stats.cities}</dd>
      </div>
      <div>
        <dt>{t('match.soldiers')}</dt>
        <dd>{stats.soldiers}</dd>
      </div>
      <div>
        <dt>{t('match.gold')}</dt>
        <dd>{stats.gold}</dd>
      </div>
      <div>
        <dt>{t('match.score')}</dt>
        <dd>{stats.score}</dd>
      </div>
    </dl>
  );
}

export function MatchEnd(props: {
  readonly view: PlayerView;
  readonly replay?: readonly PlayerView[];
  readonly onAgain?: () => void;
}): React.JSX.Element | null {
  const end = matchEnd(props.view);
  if (!end) return null;
  const stats = matchStatistics(props.view);
  const frames = replayFrames([...(props.replay ?? []), props.view]);
  return (
    <div className={styles.card} role="dialog" aria-label={t('match.end')}>
      <h2 className={styles.title}>{t(end.won ? 'match.won' : 'match.lost')}</h2>
      <p className={styles.line}>
        {t('match.place')} #{end.place}/{end.of}
      </p>
      {!end.won && (
        <p className={styles.line}>
          {t('match.winner')}: {t('match.player')} {end.winner}
        </p>
      )}
      <Statistics stats={stats} />
      <Replay frames={frames} />
      <button
        type="button"
        className={styles.again}
        onClick={props.onAgain ?? (() => window.location.reload())}
      >
        {t('match.again')}
      </button>
    </div>
  );
}
