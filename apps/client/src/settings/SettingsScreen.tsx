import { IconArrowLeft } from '@tabler/icons-react';
import { useState } from 'react';

import { SettingsPanel } from './SettingsPanel.tsx';
import styles from './SettingsScreen.module.css';
import { PREF_TERRITORY_LABELS, useBoolPref } from './bool-pref.ts';
import { t } from '../i18n/dict.ts';

type Tab = 'screen' | 'game';
const TABS: readonly Tab[] = ['screen', 'game'];

/**
 * Экран настроек: занимает место меню (главного или паузы), слева вкладки, справа параметры вкладки,
 * вверху «Назад». Настройки применяются сразу, кнопки «сохранить» нет.
 */
export function SettingsScreen(props: { readonly onBack: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('screen');
  return (
    <div className={styles.screen} role="dialog" aria-label={t('settings.title')}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={props.onBack}>
          <IconArrowLeft size={20} aria-hidden="true" />
          {t('settings.back')}
        </button>
        <h2 className={styles.title}>{t('settings.title')}</h2>
      </header>
      <div className={styles.body}>
        <div className={styles.tabs} role="tablist" aria-orientation="vertical">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tab} ${tab === id ? styles.tabOn : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>
        <div className={styles.content} role="tabpanel">
          {tab === 'screen' ? <SettingsPanel /> : <GameTab />}
        </div>
      </div>
    </div>
  );
}

function GameTab(): React.JSX.Element {
  const [labels, setLabels] = useBoolPref(PREF_TERRITORY_LABELS, true);
  return (
    <div className={styles.group}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={labels}
          onChange={(event) => setLabels(event.target.checked)}
        />
        <span>
          {t('settings.labels')}
          <small className={styles.hint}>{t('settings.labelsHint')}</small>
        </span>
      </label>
    </div>
  );
}
