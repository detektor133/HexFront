import styles from './MainMenu.module.css';
import { t } from '../i18n/dict.ts';
import { quickMatchUrl } from '../routes.ts';

/** Главное меню быстрого локального матча. */
export function MainMenu(): React.JSX.Element {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="main-menu-title">
        <p className={styles.kicker}>Hexfront</p>
        <h1 id="main-menu-title" className={styles.title}>
          {t('menu.title')}
        </h1>
        <p className={styles.subtitle}>{t('menu.subtitle')}</p>
        <a className={styles.play} href={quickMatchUrl()}>
          {t('menu.play')}
        </a>
      </section>
    </main>
  );
}
