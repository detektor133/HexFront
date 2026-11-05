import styles from './MainMenu.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { readDone } from '../tutorial/engine.ts';
import { tutorialUrl } from '../tutorial/links.ts';
import { CHAPTERS, type ChapterId } from '../tutorial/script.ts';

// Обучение в меню — не отдельная сцена и не окно поверх: содержимое карточки главного меню
// заменяется, а карта на фоне остаётся.

/** Вопрос при первом запуске: пройти обучение или пропустить. */
export function TutorialAsk(props: {
  readonly name: string;
  readonly color: string;
  readonly onNo: () => void;
}): React.JSX.Element {
  return (
    <>
      <h1 id="main-menu-title" className={styles.title}>
        {t('tutorial.askTitle')}
      </h1>
      <p className={styles.subtitle}>{t('tutorial.askText')}</p>
      <a
        className={styles.play}
        role="button"
        href={tutorialUrl('core', props.name, props.color)}
        onClick={props.onNo}
      >
        {t('tutorial.askYes')}
      </a>
      <button type="button" className={styles.tutorialButton} onClick={props.onNo}>
        {t('tutorial.askNo')}
      </button>
    </>
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
    <>
      <h1 id="main-menu-title" className={styles.title}>
        {t('tutorial.menuButton')}
      </h1>
      <div className={styles.chapters}>
        {CHAPTERS.map((chapter) => (
          <a
            key={chapter}
            className={styles.chapter}
            role="button"
            href={tutorialUrl(chapter, props.name, props.color)}
          >
            <span>{t(`tutorial.chapter.${chapter}` as MessageKey)}</span>
            {done.has(chapter) && <small>{t('tutorial.passed')}</small>}
          </a>
        ))}
      </div>
      <button type="button" className={styles.tutorialButton} onClick={props.onClose}>
        {t('tutorial.close')}
      </button>
    </>
  );
}
