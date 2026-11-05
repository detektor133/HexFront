import { IconCoinOff, IconHammer, IconBan } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import styles from './BuildFeedbackMark.module.css';
import type { BuildFeedback } from './map-modes.ts';
import { t } from '../i18n/dict.ts';

/** Время жизни отметки клика, мс: совпадает с длиной анимации в CSS. */
const LIFE_MS = 1100;

/**
 * Отметка клика в режиме строительства у курсора: «Строим» — кольцо расходится и молоточек
 * подпрыгивает; «Не хватает золота» и «Здесь нельзя» — красная метка с подписью дрожит.
 */
export function BuildFeedbackMark(props: {
  readonly feedback: BuildFeedback | null;
}): React.JSX.Element | null {
  const { feedback } = props;
  const [shownId, setShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!feedback) return;
    setShownId(feedback.id);
    const timer = window.setTimeout(() => setShownId(null), LIFE_MS);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  if (!feedback || shownId !== feedback.id) return null;
  const ok = feedback.kind === 'ok';
  const Icon = ok ? IconHammer : feedback.kind === 'gold' ? IconCoinOff : IconBan;
  const text = t(
    ok ? 'build.started' : feedback.kind === 'gold' ? 'build.noGold' : 'build.blocked',
  );
  return (
    <div
      key={feedback.id}
      className={ok ? styles.ok : styles.fail}
      style={{ left: feedback.x, top: feedback.y }}
      role="status"
    >
      <span className={styles.ring} />
      <span className={styles.badge}>
        <Icon size={18} aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}
