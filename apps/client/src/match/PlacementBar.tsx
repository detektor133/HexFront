// Выбор места старта: панель сверху по центру. Игрок нажимает на карту, игра берёт ближайшую
// стартовую точку; «Случайно» оставляет выбор игре. В сети идёт отсчёт до начала матча.
import { useEffect, useState } from 'react';

import styles from './PlacementBar.module.css';
import { placement, usePlacement } from './placement.ts';
import { t } from '../i18n/dict.ts';

export function PlacementBar(): React.JSX.Element | null {
  const state = usePlacement();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!state.active || state.endsAt === null) return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [state.active, state.endsAt]);
  if (!state.active) return null;
  const left = state.endsAt === null ? null : Math.max(0, Math.ceil((state.endsAt - now) / 1000));
  return (
    <section className={styles.bar} aria-label={t('place.title')}>
      <div className={styles.text}>
        <b>{t('place.title')}</b>
        <small>{state.decided ? t('place.wait') : t('place.hint')}</small>
      </div>
      {left !== null && <span className={styles.timer}>{left}</span>}
      <button
        type="button"
        className={styles.ghost}
        onClick={() => {
          placement.tap(null);
          if (state.canConfirm) placement.confirm();
        }}
      >
        {t('place.random')}
      </button>
      {state.canConfirm && (
        <button type="button" className={styles.primary} onClick={placement.confirm}>
          {t('place.start')}
        </button>
      )}
    </section>
  );
}
