import { IconHome, IconPlayerPlay, IconRefresh, IconSettings } from '@tabler/icons-react';
import { useState } from 'react';

import styles from './PauseMenu.module.css';
import { t } from '../i18n/dict.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';

/** Настройки в паузе: по центру окна, шире меню паузы и не выше окна (листаются внутри). */
const SETTINGS_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  top: '50%',
  // Отдельное свойство translate: анимация окна занимает transform.
  translate: '-50% -50%',
  width: 'min(560px, calc(100vw - 32px))',
  height: 'auto',
  maxHeight: 'calc(100dvh - 32px)',
  overflowY: 'auto',
};

export function PauseMenu(props: {
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onMenu: () => void;
  readonly style?: React.CSSProperties | undefined;
  /** Класс анимации появления и закрытия (ui/use-tv-presence.ts). */
  readonly className?: string | undefined;
}): React.JSX.Element {
  const [settings, setSettings] = useState(false);
  if (settings) {
    return (
      <div className={`${styles.menu} ${props.className ?? ''}`} style={SETTINGS_STYLE}>
        <SettingsScreen onBack={() => setSettings(false)} />
      </div>
    );
  }
  return (
    <div
      className={`${styles.menu} ${props.className ?? ''}`}
      style={props.style}
      role="dialog"
      aria-label={t('pause.title')}
    >
      <div className={styles.head}>
        <h2 className={styles.title}>{t('pause.title')}</h2>
        <button
          type="button"
          className={styles.gear}
          aria-label={t('settings.title')}
          onClick={() => setSettings(true)}
        >
          <IconSettings size={22} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className={styles.primary} onClick={props.onResume}>
        <IconPlayerPlay size={22} aria-hidden="true" />
        {t('pause.resume')}
      </button>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={props.onRestart}>
          <IconRefresh size={20} aria-hidden="true" />
          {t('pause.restart')}
        </button>
        <button type="button" className={styles.button} onClick={props.onMenu}>
          <IconHome size={20} aria-hidden="true" />
          {t('pause.menu')}
        </button>
      </div>
    </div>
  );
}
