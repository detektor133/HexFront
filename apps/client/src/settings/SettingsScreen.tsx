import { IconArrowLeft } from '@tabler/icons-react';
import { useState } from 'react';

import { SettingsPanel } from './SettingsPanel.tsx';
import styles from './SettingsScreen.module.css';
import { useArmyStep } from './army-step.ts';
import { STEP_CHOICES } from '../dev/army-limit.ts';
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
  const [step, setStep] = useArmyStep();
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{t('settings.armyStep')}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={t('settings.armyStep')}>
        {STEP_CHOICES.map((pct) => (
          <button
            key={pct}
            type="button"
            role="radio"
            aria-checked={pct === step}
            className={`${styles.segment} ${pct === step ? styles.segmentOn : ''}`}
            onClick={() => setStep(pct)}
          >
            {pct}%
          </button>
        ))}
      </div>
      <p className={styles.hint}>{t('settings.armyStepHint')}</p>
    </div>
  );
}
