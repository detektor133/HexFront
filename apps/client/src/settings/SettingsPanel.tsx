import { IconSun } from '@tabler/icons-react';

import styles from './SettingsPanel.module.css';
import {
  BRIGHTNESS_DEFAULT,
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  BRIGHTNESS_STEP,
  useBrightness,
} from './brightness.ts';
import { t } from '../i18n/dict.ts';

/** Настройки игры: пока одна — яркость карты. Применяется сразу, без кнопки «сохранить». */
export function SettingsPanel(): React.JSX.Element {
  const [brightness, setBrightness] = useBrightness();
  return (
    <div className={styles.panel} role="group" aria-label={t('settings.title')}>
      <label className={styles.field}>
        <span className={styles.label}>
          <IconSun size={18} aria-hidden="true" />
          {t('settings.brightness')}
          <span className={styles.value}>{brightness}%</span>
        </span>
        <input
          type="range"
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={BRIGHTNESS_STEP}
          value={brightness}
          onChange={(event) => setBrightness(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className={styles.reset}
        disabled={brightness === BRIGHTNESS_DEFAULT}
        onClick={() => setBrightness(BRIGHTNESS_DEFAULT)}
      >
        {t('settings.reset')}
      </button>
    </div>
  );
}
