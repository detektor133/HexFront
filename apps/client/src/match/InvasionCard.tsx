import { IconAnchor, IconX } from '@tabler/icons-react';

import styles from './InvasionCard.module.css';
import type { InvasionHint } from './invasion.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Карточка морского вторжения: шаг, что подсвечено на карте, вместимость порта и ошибка нажатия. */
export function InvasionCard(props: {
  readonly hint: InvasionHint;
  readonly onCancel: () => void;
  /** Отступ сверху (высота HUD), px. */
  readonly top: number;
}): React.JSX.Element {
  const { hint } = props;
  const error = hint.error;
  return (
    <section
      className={styles.card}
      style={{ top: props.top + 8 }}
      aria-live="polite"
      data-tutorial="invade-card"
    >
      <header className={styles.head}>
        <IconAnchor size={18} aria-hidden="true" />
        <h2 className={styles.title}>{t('invade.title')}</h2>
        <IconButton label={t('invade.cancel')} className={styles.close} onClick={props.onCancel}>
          <IconX size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <ol className={styles.steps}>
        <li className={hint.stage === 'from' ? styles.now : undefined}>{t('invade.pickFrom')}</li>
        <li className={hint.stage === 'to' ? styles.now : undefined}>{t('invade.pickTo')}</li>
      </ol>
      {hint.stage === 'to' && (
        <p className={styles.note}>
          {t('invade.capacity')
            .replace('{n}', String(hint.soldiers))
            .replace('{max}', String(hint.capacity))}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error.startsWith('invade.') ? t(error as 'invade.noPort') : reasonText(error)}
        </p>
      )}
    </section>
  );
}
