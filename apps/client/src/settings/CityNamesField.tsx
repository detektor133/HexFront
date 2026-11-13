import { useState } from 'react';

import styles from './SettingsScreen.module.css';
import { readCityNames, writeCityNames } from './city-names-pref.ts';
import { t } from '../i18n/dict.ts';

/** Поле «Свои названия городов»: по одному в строке; сохраняется, когда фокус уходит из поля. */
export function CityNamesField(): React.JSX.Element {
  const [text, setText] = useState(() => readCityNames().join('\n'));
  return (
    <div className={styles.group}>
      <label className={styles.groupLabel} htmlFor="city-names">
        {t('settings.cityNames')}
      </label>
      <textarea
        id="city-names"
        className={styles.namesField}
        value={text}
        placeholder={t('settings.cityNamesPlaceholder')}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => setText(writeCityNames(text.split('\n')).join('\n'))}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <p className={styles.hint}>{t('settings.cityNamesHint')}</p>
    </div>
  );
}
