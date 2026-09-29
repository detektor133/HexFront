import type { PlayerView } from '@hexfront/sim';

import styles from './MatchEnd.module.css';
import { matchEnd } from './match-end.ts';
import { t } from '../i18n/dict.ts';

/** Карточка «Конец матча» (07-controls.md, «Экраны MVP», п. 4, упрощённо): итог, место, «Ещё раз». */
export function MatchEnd(props: { view: PlayerView }): React.JSX.Element | null {
  const end = matchEnd(props.view);
  if (!end) return null;
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
      <button type="button" className={styles.again} onClick={() => window.location.reload()}>
        {t('match.again')}
      </button>
    </div>
  );
}
