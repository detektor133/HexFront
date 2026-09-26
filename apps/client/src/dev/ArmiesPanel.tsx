import type { Command, PlanView, PlayerView } from '@hexfront/sim';

import styles from './ArmiesPanel.module.css';
import { armyName } from './army-name.ts';
import type { Draft, DraftMode } from './plan-draft.ts';
import type { Picked } from './sandbox-selection.ts';
import { t } from '../i18n/dict.ts';
import { formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';

/** План армии строкой: «Фронт ▸ Игрок 2 · наступает», «Линия обороны» или «Без плана». */
function planText(plan: PlanView | undefined): string {
  if (!plan) return t('plan.none');
  if (plan.kind === 'line') return t('plan.line');
  const enemy = t('plan.player').replace('{n}', String(plan.enemyId + 1));
  const front = t('plan.frontVs').replace('{enemy}', enemy);
  return plan.offensive ? `${front} · ${t('plan.attacking')}` : front;
}

/**
 * Панель армий песочницы (CR-001, 07-controls.md, «Панель армий»): армии, резерв, приказы армии,
 * выбор отрядов армии, планы (CR-002), «Автопополнение». Временный вид до 04/T8.
 */
export function ArmiesPanel(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  onDraft: (d: Draft | null) => void;
}): React.JSX.Element {
  const { view, send } = props;
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const reserve = mine.filter((u) => u.armyId === null);
  const pick = (ids: readonly number[]): void =>
    props.onPick({ hex: null, units: ids, target: null });
  return (
    <aside className={styles.panel} aria-label={t('army.title')}>
      <div className={styles.row}>
        <span className={styles.name}>{t('army.title')}</span>
        <button
          type="button"
          className={styles.small}
          onClick={() => send({ t: 'createArmy', name: '' })}
        >
          {t('army.new')}
        </button>
      </div>
      {view.armies.map((a) => {
        const units = mine.filter((u) => u.armyId === a.id);
        const soldiers = units.reduce((s, u) => s + u.soldiers, 0);
        const plan = view.plans.find((p) => p.armyId === a.id);
        const draw = (mode: DraftMode): void => props.onDraft({ mode, armyId: a.id, points: [] });
        return (
          <div key={a.id} className={styles.row}>
            <span>
              <span
                className={styles.swatch}
                style={{ background: armyColor(view.playerId, a.number) }}
              />
              <span className={styles.name}>{armyName(a)}</span>
              <br />
              <span className={styles.meta}>
                {units.length} {t('army.units')} · {formatSoldiers(soldiers)}
              </span>
              <br />
              <span className={styles.meta}>{planText(plan)}</span>
            </span>
            <span className={styles.buttons}>
              <button
                type="button"
                className={styles.small}
                onClick={() => pick(units.map((u) => u.id))}
              >
                {t('army.select')}
              </button>
              <button type="button" className={styles.small} onClick={() => draw('front')}>
                {t('plan.front')}
              </button>
              <button type="button" className={styles.small} onClick={() => draw('line')}>
                {t('plan.line')}
              </button>
              {plan?.kind === 'front' && (
                <button type="button" className={styles.small} onClick={() => draw('offensive')}>
                  {t('plan.offensive')}
                </button>
              )}
              {plan?.kind === 'front' && plan.offensive && (
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => send({ t: 'stopOffensive', armyId: a.id })}
                >
                  {t('plan.stop')}
                </button>
              )}
              <button
                type="button"
                className={styles.small}
                onClick={() => send({ t: 'armyOrder', armyId: a.id, order: 'hold' })}
              >
                {t('army.hold')}
              </button>
              <button
                type="button"
                className={styles.small}
                onClick={() => send({ t: 'armyOrder', armyId: a.id, order: 'expand' })}
              >
                {t('army.expand')}
              </button>
              <button
                type="button"
                className={styles.small}
                onClick={() => send({ t: 'disbandArmy', armyId: a.id })}
              >
                ×
              </button>
            </span>
          </div>
        );
      })}
      <div className={styles.row}>
        <span>
          <span className={styles.name}>{t('army.reserve')}</span>
          <br />
          <span className={styles.meta}>
            {reserve.length} {t('army.units')}
          </span>
        </span>
        {reserve.length > 0 && (
          <button
            type="button"
            className={styles.small}
            onClick={() => pick(reserve.map((u) => u.id))}
          >
            {t('army.select')}
          </button>
        )}
      </div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={view.me.autoReinforce}
          onChange={(e) => send({ t: 'setAutoReinforce', on: e.target.checked })}
        />
        {t('army.auto')}
      </label>
    </aside>
  );
}
