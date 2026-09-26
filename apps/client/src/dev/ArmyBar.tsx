import type { Command, PlanView, PlayerView, UnitView } from '@hexfront/sim';

import styles from './ArmyBar.module.css';
import { armyName } from './army-name.ts';
import type { Draft, DraftMode } from './plan-draft.ts';
import type { Picked } from './sandbox-selection.ts';
import { supplyColor } from './unit-chips.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const FULL = 1000;
const ORG_MAX = FULL * 100;

/** Сводка армии: солдаты, средние по солдатам организация и снабжение, отряды в истощении. */
export interface ArmyStats {
  readonly units: number;
  readonly soldiers: number;
  /** 0..1 */
  readonly org: number;
  readonly supply: number;
  readonly starving: number;
}

/** Считает сводку по своим отрядам армии (или резерва при armyId = null). */
export function armyStats(units: readonly UnitView[]): ArmyStats {
  const soldiers = units.reduce((s, u) => s + u.soldiers, 0);
  const avg = (f: (u: UnitView) => number): number =>
    units.reduce((s, u) => s + f(u) * u.soldiers, 0) / Math.max(1, soldiers);
  return {
    units: units.length,
    soldiers,
    org: avg((u) => u.org) / ORG_MAX,
    supply: avg((u) => u.supplyLevel ?? FULL) / FULL,
    starving: units.filter((u) => u.starving === true).length,
  };
}

function planText(plan: PlanView | undefined): string {
  if (!plan) return t('plan.none');
  if (plan.kind === 'line') return t('plan.onLine');
  const front = t('plan.onFront').replace('{n}', String(plan.hexes.length));
  return plan.offensive ? `${front} · ${t('plan.attacking')}` : front;
}

// Иконки приказов 20×20, линия 2, скругления — как глифы фишек (units.md, «Глифы»).
const ICONS: Record<string, React.JSX.Element> = {
  front: <polyline points="2,13 6,9 10,11 14,7 18,9" />,
  offensive: (
    <>
      <line x1="3" y1="16" x2="15" y2="5" />
      <polyline points="8,5 15,5 15,12" />
    </>
  ),
  line: (
    <>
      <line x1="2" y1="12" x2="18" y2="12" />
      <line x1="5" y1="12" x2="5" y2="7" />
      <line x1="10" y1="12" x2="10" y2="7" />
      <line x1="15" y1="12" x2="15" y2="7" />
    </>
  ),
  stop: <rect x="5" y="5" width="10" height="10" />,
  hold: <path d="M10 2 L17 5 V10 C17 14 14 17 10 18 C6 17 3 14 3 10 V5 Z" />,
  expand: (
    <>
      <circle cx="10" cy="10" r="3" />
      <line x1="10" y1="1" x2="10" y2="5" />
      <line x1="10" y1="15" x2="10" y2="19" />
      <line x1="1" y1="10" x2="5" y2="10" />
      <line x1="15" y1="10" x2="19" y2="10" />
    </>
  ),
  clear: (
    <>
      <line x1="5" y1="5" x2="15" y2="15" />
      <line x1="15" y1="5" x2="5" y2="15" />
    </>
  ),
  disband: (
    <>
      <circle cx="10" cy="10" r="7" />
      <line x1="6" y1="10" x2="14" y2="10" />
    </>
  ),
};

function Tool(props: {
  icon: string;
  label: MessageKey;
  onClick: () => void;
  disabled?: string | null;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.tool}
      disabled={Boolean(props.disabled)}
      title={props.disabled ?? t(props.label)}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 20 20" className={styles.icon} aria-hidden="true">
        {ICONS[props.icon]}
      </svg>
      <span>{t(props.label)}</span>
    </button>
  );
}

function Bar(props: { share: number; color: string }): React.JSX.Element {
  return (
    <span className={styles.meter}>
      <span
        style={{
          width: `${Math.round(Math.max(0, Math.min(1, props.share)) * 100)}%`,
          background: props.color,
        }}
      />
    </span>
  );
}

function ArmyCard(props: {
  name: string;
  color: string | null;
  stats: ArmyStats;
  plan: string;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { stats } = props;
  return (
    <button
      type="button"
      className={`${styles.card} ${props.selected ? styles.selected : ''}`}
      onClick={props.onClick}
    >
      <span className={styles.band} style={{ background: props.color ?? tokens.ui.border }} />
      <span className={styles.body}>
        <span className={styles.head}>
          <span className={styles.name}>{props.name}</span>
          <span className={styles.num}>{formatSoldiers(stats.soldiers)}</span>
        </span>
        <span className={styles.row}>
          <span className={styles.key}>{t('army.org')}</span>
          <Bar share={stats.org} color={tokens.status.success} />
        </span>
        <span className={styles.row}>
          <span className={styles.key}>{t('army.supply')}</span>
          <Bar share={stats.supply} color={supplyColor(stats.supply, stats.starving > 0)} />
        </span>
        <span className={stats.starving > 0 ? styles.alarm : styles.meta}>
          {stats.starving > 0
            ? t('army.starving').replace('{n}', String(stats.starving))
            : `${stats.units} ${t('army.units')} · ${props.plan}`}
        </span>
      </span>
    </button>
  );
}

/**
 * Панель армий как в HoI4 (07-controls.md, «Панель армий», CR-003): внизу ряд карточек армий
 * (цвет, солдаты, организация, снабжение, истощение, план), над ним — приказы выбранной армии.
 */
export function ArmyBar(props: {
  view: PlayerView;
  selected: number | null;
  onSelect: (armyId: number | null) => void;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  onDraft: (d: Draft | null) => void;
}): React.JSX.Element {
  const { view, send, selected } = props;
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const army = view.armies.find((a) => a.id === selected);
  const plan = army ? view.plans.find((p) => p.armyId === army.id) : undefined;
  const draw = (mode: DraftMode): void =>
    army ? props.onDraft({ mode, armyId: army.id, points: [] }) : undefined;
  const select = (armyId: number | null, units: readonly UnitView[]): void => {
    props.onSelect(armyId === selected ? null : armyId);
    props.onPick({
      hex: null,
      units: armyId === selected ? [] : units.map((u) => u.id),
      target: null,
    });
  };
  const reserve = mine.filter((u) => u.armyId === null);
  return (
    <div className={styles.dock}>
      {army && (
        <div className={styles.tools} role="toolbar" aria-label={armyName(army)}>
          <Tool icon="front" label="plan.front" onClick={() => draw('front')} />
          <Tool
            icon="offensive"
            label="plan.offensive"
            onClick={() => draw('offensive')}
            disabled={plan?.kind === 'front' ? null : t('plan.needFront')}
          />
          <Tool icon="line" label="plan.line" onClick={() => draw('line')} />
          {plan?.kind === 'front' && plan.offensive && (
            <Tool
              icon="stop"
              label="plan.stop"
              onClick={() => send({ t: 'stopOffensive', armyId: army.id })}
            />
          )}
          {plan && (
            <Tool
              icon="clear"
              label="plan.clear"
              onClick={() => send({ t: 'clearPlan', armyId: army.id })}
            />
          )}
          <Tool
            icon="hold"
            label="army.hold"
            onClick={() => send({ t: 'armyOrder', armyId: army.id, order: 'hold' })}
          />
          <Tool
            icon="expand"
            label="army.expand"
            onClick={() => send({ t: 'armyOrder', armyId: army.id, order: 'expand' })}
          />
          <Tool
            icon="disband"
            label="army.disband"
            onClick={() => {
              send({ t: 'disbandArmy', armyId: army.id });
              props.onSelect(null);
            }}
          />
        </div>
      )}
      <div className={styles.strip}>
        {view.armies.map((a) => {
          const units = mine.filter((u) => u.armyId === a.id);
          return (
            <ArmyCard
              key={a.id}
              name={armyName(a)}
              color={armyColor(view.playerId, a.number)}
              stats={armyStats(units)}
              plan={planText(view.plans.find((p) => p.armyId === a.id))}
              selected={a.id === selected}
              onClick={() => select(a.id, units)}
            />
          );
        })}
        <div className={styles.reserve}>
          <button
            type="button"
            className={styles.small}
            onClick={() =>
              props.onPick({ hex: null, units: reserve.map((u) => u.id), target: null })
            }
          >
            {t('army.reserve')}: {reserve.length} {t('army.units')}
          </button>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={view.me.autoReinforce}
              onChange={(e) => send({ t: 'setAutoReinforce', on: e.target.checked })}
            />
            {t('army.auto')}
          </label>
          <button
            type="button"
            className={styles.small}
            onClick={() => send({ t: 'createArmy', name: '' })}
          >
            + {t('army.new')}
          </button>
        </div>
      </div>
    </div>
  );
}
