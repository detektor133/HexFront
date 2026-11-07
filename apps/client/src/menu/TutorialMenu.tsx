import styles from './MainMenu.module.css';
import { t } from '../i18n/dict.ts';
import { tutorialUrl } from '../tutorial/links.ts';

// Обучение одно: вопрос при первом запуске заменяет содержимое карточки главного меню, а карта на
// фоне остаётся. Позже обучение открывает кнопка в меню.

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
        href={tutorialUrl(props.name, props.color)}
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
