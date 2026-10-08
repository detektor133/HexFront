import { useMemo, useState } from 'react';

import type { PlayerView } from '@hexfront/sim';

import styles from './OnboardingHints.module.css';
import {
  availableOnboardingHints,
  onboardingState,
  ONBOARDING_HINTS,
  type OnboardingHintId,
} from './onboarding.ts';
import { t } from '../i18n/dict.ts';

const DISMISSED_KEY = 'hexfront.onboarding.dismissed';

const HINT_TEXT: Record<
  OnboardingHintId,
  { title: Parameters<typeof t>[0]; text: Parameters<typeof t>[0] }
> = {
  autoCommand: { title: 'onboarding.auto.title', text: 'onboarding.auto.text' },
  tax: { title: 'onboarding.tax.title', text: 'onboarding.tax.text' },
  foundCity: { title: 'onboarding.city.title', text: 'onboarding.city.text' },
  front: { title: 'onboarding.front.title', text: 'onboarding.front.text' },
  offensive: { title: 'onboarding.offensive.title', text: 'onboarding.offensive.text' },
};

function readDismissed(): Set<OnboardingHintId> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.getItem(DISMISSED_KEY);
  if (!raw) return new Set();
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return new Set();
    return new Set(
      values.filter(
        (value): value is OnboardingHintId =>
          typeof value === 'string' && ONBOARDING_HINTS.includes(value as OnboardingHintId),
      ),
    );
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: ReadonlySet<OnboardingHintId>): void {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

export function OnboardingHints({ view }: { view: PlayerView }): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<Set<OnboardingHintId>>(readDismissed);
  const available = useMemo(
    () => availableOnboardingHints(onboardingState(view), dismissed),
    [dismissed, view],
  );
  const id = available[0];
  if (!id) return null;
  const hint = HINT_TEXT[id];
  const dismiss = (all: boolean): void => {
    const next = all
      ? new Set(Object.keys(HINT_TEXT) as OnboardingHintId[])
      : new Set(dismissed).add(id);
    setDismissed(next);
    saveDismissed(next);
  };
  return (
    <aside className={styles.card} aria-live="polite">
      <h2 className={styles.title}>{t(hint.title)}</h2>
      <p className={styles.text}>{t(hint.text)}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => dismiss(false)}>
          {t('onboarding.next')}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          onClick={() => dismiss(true)}
        >
          {t('onboarding.disable')}
        </button>
      </div>
    </aside>
  );
}
