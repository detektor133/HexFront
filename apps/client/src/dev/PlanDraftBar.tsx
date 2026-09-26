import type { Command } from '@hexfront/sim';

import styles from './ArmyBar.module.css';
import { draftCommand, type Draft } from './plan-draft.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

/** Плашка режима рисования плана (07-controls.md): подсказка, «Готово» / «Заново» / «Отмена». */
export function PlanDraftBar(props: {
  draft: Draft;
  send: (cmd: Command) => void;
  setDraft: (d: Draft | null) => void;
}): React.JSX.Element {
  const { draft } = props;
  const cmd = draftCommand(draft);
  return (
    <div className={styles.draft} role="status">
      <span>{t(`plan.hint.${draft.mode}` as MessageKey)}</span>
      <span className={styles.buttons}>
        <button
          type="button"
          className={styles.small}
          disabled={cmd === null}
          onClick={() => {
            if (cmd) props.send(cmd);
            props.setDraft(null);
          }}
        >
          {t('plan.done')}
        </button>
        <button
          type="button"
          className={styles.small}
          disabled={draft.points.length === 0}
          onClick={() => props.setDraft({ ...draft, points: [] })}
        >
          {t('plan.redo')}
        </button>
        <button type="button" className={styles.small} onClick={() => props.setDraft(null)}>
          {t('plan.cancel')}
        </button>
      </span>
    </div>
  );
}
