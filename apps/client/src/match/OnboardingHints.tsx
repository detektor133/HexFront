import { useState } from 'react';

import styles from './OnboardingHints.module.css';
import { nextStep, prevStep, TUTORIAL_STEPS, type TutorialButton } from './onboarding.ts';
import { t } from '../i18n/dict.ts';

const DONE_KEY = 'hexfront.tutorial.done';

function readDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Без хранилища обучение просто покажется снова.
  }
}

/** Мышь: подсвечена кнопка, о которой шаг (колесо — полоса, перетаскивание — стрелки). */
function Mouse({ button }: { button: TutorialButton }): React.JSX.Element {
  const on = 'var(--selection-color)';
  const off = 'var(--ui-surface2)';
  return (
    <svg className={styles.mouse} viewBox="0 0 48 72" aria-hidden="true">
      <rect x="6" y="4" width="36" height="64" rx="18" fill={off} stroke="var(--ui-ink2)" />
      <path d="M24 4v28M6 32h36" stroke="var(--ui-ink2)" strokeWidth="1.5" fill="none" />
      {button === 'left' && <path d="M24 5.5V31H7.5C7.5 16 14 8 24 5.5Z" fill={on} />}
      {button === 'right' && <path d="M24 5.5V31h16.5C40.5 16 34 8 24 5.5Z" fill={on} />}
      {button === 'wheel' && <rect x="21.5" y="10" width="5" height="16" rx="2.5" fill={on} />}
    </svg>
  );
}

export function OnboardingHints(): React.JSX.Element | null {
  const [done, setDone] = useState(readDone);
  const [index, setIndex] = useState(0);
  if (done) return null;
  const step = TUTORIAL_STEPS[index];
  if (!step) return null;
  const finish = (): void => {
    saveDone();
    setDone(true);
  };
  const advance = (): void => {
    const next = nextStep(index);
    if (next === null) finish();
    else setIndex(next);
  };
  const last = index === TUTORIAL_STEPS.length - 1;
  return (
    <aside
      className={styles.card}
      aria-live="polite"
      aria-label={t('tutorial.label')}
      data-testid="tutorial"
    >
      <div className={styles.body}>
        <Mouse button={step.button} />
        <div className={styles.copy}>
          <h2 className={styles.title}>
            {t(`tutorial.${step.id}.title` as Parameters<typeof t>[0])}
          </h2>
          <p className={styles.text}>{t(`tutorial.${step.id}.text` as Parameters<typeof t>[0])}</p>
        </div>
      </div>
      <div className={styles.footer}>
        <ol className={styles.dots} aria-label={`${index + 1} / ${TUTORIAL_STEPS.length}`}>
          {TUTORIAL_STEPS.map((s, i) => (
            <li key={s.id} className={i === index ? styles.dotActive : styles.dot} />
          ))}
        </ol>
        <div className={styles.actions}>
          <button type="button" className={styles.link} onClick={finish}>
            {t('tutorial.skip')}
          </button>
          {index > 0 && (
            <button
              type="button"
              className={`${styles.button} ${styles.secondary}`}
              onClick={() => setIndex(prevStep(index))}
            >
              {t('tutorial.back')}
            </button>
          )}
          <button type="button" className={styles.button} onClick={advance}>
            {last ? t('tutorial.done') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </aside>
  );
}
