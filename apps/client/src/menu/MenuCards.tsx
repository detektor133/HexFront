// Вид «Карточки»: затемнённая живая карта, крупная карточка онлайна и две поменьше.
import { IconRobot, IconSchool } from '@tabler/icons-react';
import { useState } from 'react';

import { ModePanel } from './MenuParts.tsx';
import styles from './menu-variants.module.css';
import { modeName, modeSub, type ModeId } from './mode-items.ts';
import type { VariantProps } from './variant-props.ts';
import { t } from '../i18n/dict.ts';

export function MenuCards(props: VariantProps): React.JSX.Element {
  const [mode, setMode] = useState<ModeId | null>(null);
  return (
    <>
      <div className={styles.dim} />
      <div className={styles.cards}>
        {mode !== null ? (
          <ModePanel
            mode={mode}
            settings={props.settings}
            update={props.update}
            go={props.go}
            onBack={() => setMode(null)}
          />
        ) : (
          <>
            <section className={styles.hero} aria-label={modeName('online')}>
              <h2>{modeName('online')}</h2>
              <p>{modeSub('online')}</p>
              <button type="button" className={styles.cta} onClick={() => props.go('/online')}>
                {t('menu.quick')}
              </button>
              <div className={styles.linkRow}>
                <button type="button" onClick={() => props.go('/online?mode=private')}>
                  {t('menu.lobby')}
                </button>
                <button type="button" onClick={() => setMode('online')}>
                  {t('menu.joinCode')}
                </button>
              </div>
            </section>
            <div className={styles.cardRow}>
              <button type="button" className={styles.card} onClick={() => setMode('bots')}>
                <IconRobot size={28} aria-hidden="true" />
                {modeName('bots')}
                <small>{modeSub('bots')}</small>
              </button>
              <button type="button" className={styles.card} onClick={() => setMode('tutorial')}>
                <IconSchool size={28} aria-hidden="true" />
                {modeName('tutorial')}
                <small>{modeSub('tutorial')}</small>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
