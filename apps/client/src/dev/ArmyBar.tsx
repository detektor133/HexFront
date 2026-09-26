import { ORG_MAX, type Command, type PlayerView, type UnitView } from '@hexfront/sim';

import styles from './ArmyBar.module.css';
import { armyName } from './army-name.ts';
import type { Tool as PlanTool } from './plan-draft.ts';
import type { ToolState } from './plan-tools.ts';
import type { Picked } from './sandbox-selection.ts';
import { supplyColor } from './unit-chips.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const FULL = 1000;

/** Сводка армии: средние по солдатам организация и снабжение (0..1), отряды в истощении. */
export interface ArmyStats {
  readonly org: number;
  readonly supply: number;
  readonly starving: number;
}

/** Считает сводку по своим отрядам армии. */
export function armyStats(units: readonly UnitView[]): ArmyStats {
  const soldiers = units.reduce((s, u) => s + u.soldiers, 0);
  const avg = (f: (u: UnitView) => number): number =>
    units.reduce((s, u) => s + f(u) * u.soldiers, 0) / Math.max(1, soldiers);
  return {
    org: avg((u) => u.org) / ORG_MAX,
    supply: avg((u) => u.supplyLevel ?? FULL) / FULL,
    starving: units.filter((u) => u.starving === true).length,
  };
}

// Иконки 20×20, линия 2, скругления — как глифы фишек (units.md, «Глифы»). Только иконки: подпись —
// во всплывающей подсказке и для экранного диктора.
const ICONS: Record<string, React.JSX.Element> = {
  front: <polyline points="2,13 6,9 10,11 14,7 18,9" />,
  offensive: (
    <>
      <line x1="3" y1="16" x2="15" y2="5" />
      <polyline points="8,5 15,5 15,12" />
    </>
  ),
  start: <polygon points="6,4 16,10 6,16" />,
  pause: (
    <>
      <line x1="7" y1="4" x2="7" y2="16" />
      <line x1="13" y1="4" x2="13" y2="16" />
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
  erase: <path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 17 H13 L14 6" />,
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
  disband: (
    <>
      <circle cx="10" cy="10" r="7" />
      <line x1="6" y1="10" x2="14" y2="10" />
    </>
  ),
  org: <path d="M5 18 V3 M5 4 H15 L12 7.5 L15 11 H5" />,
  supply: (
    <>
      <rect x="3" y="7" width="14" height="10" />
      <path d="M3 7 L6 3 H14 L17 7 M10 7 V11" />
    </>
  ),
  warn: <path d="M10 3 L18 17 H2 Z M10 8 V12 M10 14.5 V15" />,
  reserve: (
    <>
      <circle cx="7" cy="7" r="3" />
      <circle cx="14" cy="8" r="2.5" />
      <path d="M2 17 C2 13 12 13 12 17 M12 13 C14 12 18 13 18 16" />
    </>
  ),
  auto: <path d="M4 10 A6 6 0 0 1 15 6 M15 2 V6 H11 M16 10 A6 6 0 0 1 5 14 M5 18 V14 H9" />,
  add: (
    <>
      <line x1="10" y1="4" x2="10" y2="16" />
      <line x1="4" y1="10" x2="16" y2="10" />
    </>
  ),
};

function Icon(props: { name: string; className?: string | undefined }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className={props.className ?? styles.icon} aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  );
}

function Tool(props: {
  icon: string;
  label: MessageKey;
  onClick: () => void;
  disabled?: string | null;
  active?: boolean;
}): React.JSX.Element {
  const label = props.disabled ?? t(props.label);
  return (
    <button
      type="button"
      className={styles.tool}
      aria-pressed={props.active ?? false}
      aria-label={label}
      disabled={Boolean(props.disabled)}
      title={label}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
    </button>
  );
}

function Meter(props: {
  icon: string;
  label: MessageKey;
  share: number;
  color: string;
}): React.JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, props.share)) * 100);
  return (
    <span className={styles.row} title={`${t(props.label)}: ${pct}%`}>
      <Icon name={props.icon} className={styles.meterIcon} />
      <span className={styles.meter}>
        <span style={{ width: `${pct}%`, background: props.color }} />
      </span>
    </span>
  );
}

function ArmyCard(props: {
  name: string;
  color: string;
  stats: ArmyStats;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const { stats } = props;
  return (
    <button
      type="button"
      className={`${styles.card} ${props.selected ? styles.selected : ''}`}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className={styles.band} style={{ background: props.color }} />
      <span className={styles.body}>
        <span className={styles.head}>
          <span className={styles.name}>{props.name}</span>
          {stats.starving > 0 && (
            <span title={t('army.starving').replace('{n}', String(stats.starving))}>
              <Icon name="warn" className={styles.alarmIcon} />
            </span>
          )}
        </span>
        <Meter icon="org" label="army.org" share={stats.org} color={tokens.chip.org} />
        <Meter
          icon="supply"
          label="army.supply"
          share={stats.supply}
          color={supplyColor(stats.supply, stats.starving > 0)}
        />
      </span>
    </button>
  );
}

/**
 * Панель армий как в HoI4 (07-controls.md, «Панель армий», CR-005): внизу карточки армий
 * (закладка цвета, название, организация, снабжение), над выбранной — приказы иконками.
 */
export function ArmyBar(props: {
  view: PlayerView;
  selected: number | null;
  /** Армии, отряды которых сейчас выбраны на карте, — их карточки в золотой рамке. */
  pickedArmies: readonly number[];
  onSelect: (armyId: number | null) => void;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  tool: ToolState | null;
  onTool: (t: ToolState | null) => void;
}): React.JSX.Element {
  const { view, send, selected } = props;
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const army = view.armies.find((a) => a.id === selected);
  const plan = army ? view.plans.find((p) => p.armyId === army.id) : undefined;
  const offensive = plan?.kind === 'front' ? plan.offensive : null;
  const active = (tool: PlanTool): boolean =>
    props.tool?.tool === tool && props.tool.armyId === army?.id;
  // Повторное нажатие на включённый инструмент — выключить (как в HoI4).
  const use = (tool: PlanTool): void =>
    army ? props.onTool(active(tool) ? null : { tool, armyId: army.id }) : undefined;
  const select = (armyId: number, units: readonly UnitView[]): void => {
    const off = armyId === selected;
    props.onSelect(off ? null : armyId);
    props.onPick({ hex: null, units: off ? [] : units.map((u) => u.id), target: null });
  };
  const reserve = mine.filter((u) => u.armyId === null);
  return (
    <div className={styles.dock}>
      {army && (
        <div className={styles.tools} role="toolbar" aria-label={armyName(army)}>
          <Tool
            icon="front"
            label="plan.front"
            onClick={() => use('front')}
            active={active('front')}
          />
          <Tool
            icon="offensive"
            label="plan.offensive"
            onClick={() => use('offensive')}
            active={active('offensive')}
            disabled={plan?.kind === 'front' ? null : t('plan.needFront')}
          />
          {offensive && !offensive.active && (
            <Tool
              icon="start"
              label="plan.start"
              onClick={() => send({ t: 'startOffensive', armyId: army.id })}
            />
          )}
          {offensive?.active && (
            <Tool
              icon="pause"
              label="plan.pause"
              onClick={() => send({ t: 'stopOffensive', armyId: army.id })}
            />
          )}
          <Tool icon="line" label="plan.line" onClick={() => use('line')} active={active('line')} />
          <Tool
            icon="erase"
            label="plan.erase"
            onClick={() => use('erase')}
            active={active('erase')}
            disabled={view.plans.length > 0 ? null : t('plan.nothingToErase')}
          />
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
              color={armyColor(a.number)}
              stats={armyStats(units)}
              selected={a.id === selected || props.pickedArmies.includes(a.id)}
              onClick={() => select(a.id, units)}
            />
          );
        })}
        <div className={styles.reserve}>
          <button
            type="button"
            className={styles.iconButton}
            title={t('army.reserve')}
            aria-label={t('army.reserve')}
            onClick={() =>
              props.onPick({ hex: null, units: reserve.map((u) => u.id), target: null })
            }
          >
            <Icon name="reserve" />
            <span className={styles.num}>{reserve.length}</span>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-pressed={view.me.autoReinforce}
            title={t('army.auto')}
            aria-label={t('army.auto')}
            onClick={() => send({ t: 'setAutoReinforce', on: !view.me.autoReinforce })}
          >
            <Icon name="auto" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            title={t('army.new')}
            aria-label={t('army.new')}
            onClick={() => send({ t: 'createArmy', name: '' })}
          >
            <Icon name="add" />
          </button>
        </div>
      </div>
    </div>
  );
}
