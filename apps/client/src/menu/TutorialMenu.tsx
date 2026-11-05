import styles from './TutorialMenu.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { readDone } from '../tutorial/engine.ts';
import { tutorialUrl } from '../tutorial/links.ts';
import { CHAPTERS, type ChapterId } from '../tutorial/script.ts';

/** Вопрос при первом запуске: пройти обучение или пропустить. */
export function TutorialAsk(props: {
  readonly name: string;
  readonly color: string;
  readonly onNo: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-label={t('tutorial.askTitle')}>
        <h2 className={styles.title}>{t('tutorial.askTitle')}</h2>
        <p className={styles.text}>{t('tutorial.askText')}</p>
        <div className={styles.actions}>
          <a
            className={styles.primary}
            role="button"
            href={tutorialUrl('core', props.name, props.color)}
            onClick={props.onNo}
          >
            {t('tutorial.askYes')}
          </a>
          <button type="button" className={styles.secondary} onClick={props.onNo}>
            {t('tutorial.askNo')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Список глав обучения: основы и необязательные главы; пройденные отмечены. */
export function TutorialChapters(props: {
  readonly name: string;
  readonly color: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const done = new Set<ChapterId>(readDone());
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-label={t('tutorial.menuButton')}>
        <h2 className={styles.title}>{t('tutorial.menuButton')}</h2>
        <ul className={styles.list}>
          {CHAPTERS.map((chapter) => (
            <li key={chapter}>
              <a
                className={styles.chapter}
                role="button"
                href={tutorialUrl(chapter, props.name, props.color)}
              >
                <span>{t(`tutorial.chapter.${chapter}` as MessageKey)}</span>
                {done.has(chapter) && <small>{t('tutorial.passed')}</small>}
              </a>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={props.onClose}>
            {t('tutorial.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
