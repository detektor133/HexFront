import { useState } from 'react';

import styles from './PauseMenu.module.css';
import { t } from '../i18n/dict.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';

export function PauseMenu(props: {
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onMenu: () => void;
  readonly style?: React.CSSProperties | undefined;
}): React.JSX.Element {
  const [settings, setSettings] = useState(false);
  if (settings) {
    return (
      <div className={styles.menu} style={props.style}>
        <SettingsScreen onBack={() => setSettings(false)} />
      </div>
    );
  }
  return (
    <div className={styles.menu} style={props.style} role="dialog" aria-label={t('pause.title')}>
      <h2 className={styles.title}>{t('pause.title')}</h2>
      <button type="button" className={styles.primary} onClick={props.onResume}>
        {t('pause.resume')}
      </button>
      <button type="button" className={styles.button} onClick={props.onRestart}>
        {t('pause.restart')}
      </button>
      <button type="button" className={styles.button} onClick={props.onMenu}>
        {t('pause.menu')}
      </button>
      <button type="button" className={styles.button} onClick={() => setSettings(true)}>
        {t('settings.title')}
      </button>
    </div>
  );
}
