import { IconArrowLeft } from '@tabler/icons-react';
import { useState } from 'react';

import { CityNamesField } from './CityNamesField.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import styles from './SettingsScreen.module.css';
import {
  EVENT_SECONDS_CHOICES,
  PREF_EVENT_SECONDS,
  PREF_INERTIA,
  PREF_SHOW_PING,
  PREF_TERRITORY_LABELS,
  PREF_ZOOM_SPEED,
  ZOOM_SPEED_CHOICES,
  resetPrefs,
  useBoolPref,
  useNumberPref,
} from './bool-pref.ts';
import { t } from '../i18n/dict.ts';

type Tab = 'screen' | 'game' | 'controls';
const TABS: readonly Tab[] = ['screen', 'game', 'controls'];

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
          {tab === 'screen' ? <SettingsPanel /> : tab === 'game' ? <GameTab /> : <ControlsTab />}
          {tab !== 'screen' && (
            <button type="button" className={styles.reset} onClick={resetPrefs}>
              {t('settings.reset')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ряд взаимоисключающих кнопок: выбранная подсвечена. */
function Segmented<T extends number | string>(props: {
  readonly label: string;
  readonly hint: string;
  readonly value: T;
  readonly options: readonly { readonly id: T; readonly text: string }[];
  readonly onPick: (id: T) => void;
}): React.JSX.Element {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{props.label}</span>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label={props.label}
        style={{ gridTemplateColumns: `repeat(${props.options.length}, 1fr)` }}
      >
        {props.options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === props.value}
            className={`${styles.segment} ${option.id === props.value ? styles.segmentOn : ''}`}
            onClick={() => props.onPick(option.id)}
          >
            {option.text}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{props.hint}</p>
    </div>
  );
}

/** Строка-переключатель с пояснением. */
function Toggle(props: {
  readonly label: string;
  readonly hint: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        checked={props.on}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>
        {props.label}
        <small className={styles.hint}>{props.hint}</small>
      </span>
    </label>
  );
}

function GameTab(): React.JSX.Element {
  const [labels, setLabels] = useBoolPref(PREF_TERRITORY_LABELS, true);
  const [seconds, setSeconds] = useNumberPref(PREF_EVENT_SECONDS, 20);
  const [ping, setPing] = useBoolPref(PREF_SHOW_PING, false);
  return (
    <>
      <Toggle
        label={t('settings.labels')}
        hint={t('settings.labelsHint')}
        on={labels}
        onChange={setLabels}
      />
      <Segmented
        label={t('settings.eventSeconds')}
        hint={t('settings.eventSecondsHint')}
        value={seconds}
        options={EVENT_SECONDS_CHOICES.map((n) => ({
          id: n as number,
          text: `${n} ${t('settings.sec')}`,
        }))}
        onPick={setSeconds}
      />
      <Toggle
        label={t('settings.ping')}
        hint={t('settings.pingHint')}
        on={ping}
        onChange={setPing}
      />
      <CityNamesField />
    </>
  );
}

function ControlsTab(): React.JSX.Element {
  const [zoom, setZoom] = useNumberPref(PREF_ZOOM_SPEED, 1);
  const [inertia, setInertia] = useBoolPref(PREF_INERTIA, true);
  return (
    <>
      <Segmented
        label={t('settings.zoomSpeed')}
        hint={t('settings.zoomSpeedHint')}
        value={zoom}
        options={ZOOM_SPEED_CHOICES.map((n) => ({
          id: n as number,
          text: t(n < 1 ? 'settings.slow' : n > 1 ? 'settings.fast' : 'settings.normal'),
        }))}
        onPick={setZoom}
      />
      <Toggle
        label={t('settings.inertia')}
        hint={t('settings.inertiaHint')}
        on={inertia}
        onChange={setInertia}
      />
    </>
  );
}
