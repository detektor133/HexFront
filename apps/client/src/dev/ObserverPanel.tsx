import type { PlayerView } from '@hexfront/sim';

import styles from './ObserverPanel.module.css';
import { t } from '../i18n/dict.ts';

export interface ObserverPanelProps {
  readonly view: PlayerView;
  readonly paused: boolean;
  readonly speed: number;
  readonly observerId: number | null;
  readonly setPaused: (on: boolean) => void;
  readonly step: () => void;
  readonly setSpeed: (value: number) => void;
  readonly setObserver: (playerId: number | null) => void;
}

/** Управление стендом плейтеста без участия в командах симуляции. */
export function ObserverPanel(props: ObserverPanelProps): React.JSX.Element {
  return (
    <section className={styles.panel} aria-label={t('observer.title')}>
      <button type="button" onClick={() => props.setPaused(!props.paused)}>
        {props.paused ? t('observer.resume') : t('observer.pause')}
      </button>
      <button type="button" onClick={props.step} disabled={!props.paused}>
        {t('observer.step')}
      </button>
      <div className={styles.group} role="group" aria-label={t('observer.title')}>
        {[1, 5, 20].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={props.speed === value}
            onClick={() => props.setSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
      <label>
        {t('observer.title')}
        <select
          value={props.observerId === null ? 'all' : String(props.observerId)}
          onChange={(event) => {
            const value = event.target.value;
            props.setObserver(value === 'all' ? null : Number(value));
          }}
        >
          <option value="all">{t('observer.allMap')}</option>
          {props.view.players.map((player) => (
            <option key={player.id} value={player.id}>
              {t('observer.player')} {player.id + 1}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
