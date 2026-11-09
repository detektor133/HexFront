import {
  IconAdjustmentsHorizontal,
  IconAnchor,
  IconFlag,
  IconHourglass,
  IconMinus,
  IconShield,
  IconStarFilled,
  IconSwords,
} from '@tabler/icons-react';
import { type WheelEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  FP,
  ORG_MAX,
  OFFENSIVE_STOP_ORG,
  type ArmyView,
  type Command,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import styles from './ArmyBar.module.css';
import { ArmyLimit } from './ArmyLimit.tsx';
import { RollNumber } from './RollNumber.tsx';
import { StepPlus } from './StepPlus.tsx';
import {
  DEFAULT_STEP,
  STEP_CHOICES,
  armySize,
  limitCommand,
  maxArmySoldiers,
  stepSize,
  type StepPct,
} from './army-limit.ts';
import { armyName, MAX_ARMY_NAME_LENGTH, normalizeArmyName } from './army-name.ts';
import { armyResizeCost } from './army-order.ts';
import { armyCounts, orderFields } from './direction-order.ts';
import { countsFromShares, sharesFromCounts } from './force-share.ts';
import type { Picked } from './sandbox-selection.ts';
import { supplyColor } from './unit-chips.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

const FULL = 1000;
const STEP_KEY = 'hexfront.armyStep';

/** Сохранённый шаг «+/−» игрока или шаг по умолчанию. */
function readStep(): StepPct {
  try {
    const saved = Number(localStorage.getItem(STEP_KEY));
    return STEP_CHOICES.find((pct) => pct === saved) ?? DEFAULT_STEP;
  } catch {
    return DEFAULT_STEP;
  }
}

/** Сводка армии: средние по солдатам организация и снабжение (0..1), отряды в истощении. */
export interface ArmyStats {
  /** Всего солдат в армии. */
  readonly soldiers: number;
  readonly org: number;
  readonly supply: number;
  readonly starving: number;
  readonly fighting: boolean;
  readonly encircled: number;
}

/** Считает сводку по своим отрядам армии. */
export function armyStats(units: readonly UnitView[]): ArmyStats {
  const soldiers = units.reduce((s, u) => s + u.soldiers, 0);
  const avg = (f: (u: UnitView) => number): number =>
    units.reduce((s, u) => s + f(u) * u.soldiers, 0) / Math.max(1, soldiers);
  return {
    soldiers,
    org: avg((u) => u.org) / ORG_MAX,
    supply: avg((u) => u.supplyLevel ?? FULL) / FULL,
    starving: units.filter((u) => u.starving === true).length,
    fighting: units.some((u) => u.inBattle === true),
    encircled: units.filter((u) => u.encircled === true).length,
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
  stop: <polygon points="5,5 15,5 15,15 5,15" />,
  // «Упёрлись»: стрелка упирается в черту (07-controls.md, «Линия наступления»).
  stuck: (
    <>
      <line x1="3" y1="10" x2="12" y2="10" />
      <polyline points="9,7 12,10 9,13" />
      <line x1="16" y1="4" x2="16" y2="16" />
    </>
  ),
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
  fighting: (
    <>
      <line x1="4" y1="4" x2="16" y2="16" />
      <line x1="16" y1="4" x2="4" y2="16" />
    </>
  ),
  encircled: (
    <>
      <circle cx="10" cy="10" r="6" />
      <line x1="10" y1="2" x2="10" y2="5" />
      <line x1="10" y1="15" x2="10" y2="18" />
    </>
  ),
  reserve: (
    <>
      <circle cx="7" cy="7" r="3" />
      <circle cx="14" cy="8" r="2.5" />
      <path d="M2 17 C2 13 12 13 12 17 M12 13 C14 12 18 13 18 16" />
    </>
  ),
  auto: <path d="M4 10 A6 6 0 0 1 15 6 M15 2 V6 H11 M16 10 A6 6 0 0 1 5 14 M5 18 V14 H9" />,
  split: (
    <>
      <line x1="10" y1="3" x2="10" y2="9" />
      <polyline points="4,17 4,12 10,9 16,12 16,17" />
    </>
  ),
  edit: <path d="M4 16 L5 12 L14 3 L17 6 L8 15 Z M12 5 L15 8" />,
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
  icon?: string;
  /** Готовый значок вместо набора ICONS. */
  glyph?: React.ReactNode;
  label: MessageKey;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: string | null;
  active?: boolean;
  tutorial?: string;
}): React.JSX.Element {
  const label = props.disabled ?? t(props.label);
  return (
    <IconButton
      data-tutorial={props.tutorial}
      type="button"
      className={styles.tool}
      label={label}
      aria-pressed={props.active ?? false}
      disabled={Boolean(props.disabled)}
      onClick={props.onClick}
    >
      {props.glyph ?? <Icon name={props.icon ?? ''} />}
    </IconButton>
  );
}

/** Вертикальный столбик на карточке: доля снизу вверх, как у фишки отряда. */
function Meter(props: { label: MessageKey; share: number; color: string }): React.JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, props.share)) * 100);
  return (
    <span className={styles.vbar} title={`${t(props.label)}: ${pct}%`}>
      <span style={{ height: `${pct}%`, background: props.color }} />
    </span>
  );
}

/** Значок приказа армии: щит — держит границу, мечи — наступает, флаг — занимает; точка — цвет цели. */
function OrderBadge(props: {
  readonly dir: ArmyView['dir'] | undefined;
  /** Морской десант: якорь вместо значка приказа. */
  readonly sea?: boolean | undefined;
}): React.JSX.Element | null {
  if (props.sea === true) {
    return (
      <span className={styles.order} title={t('army.invade')}>
        <IconAnchor size={14} aria-hidden="true" />
      </span>
    );
  }
  const dir = props.dir;
  if (!dir || dir.mode === 'idle') return null;
  const neutral = dir.target < 0;
  const Glyph = dir.mode === 'hold' ? IconShield : neutral ? IconFlag : IconSwords;
  const color = neutral
    ? tokens.neutral.line
    : (tokens.players.palette[dir.target]?.line ?? tokens.ui.ink);
  const label = t(dir.mode === 'hold' ? 'menu.hold' : neutral ? 'menu.occupy' : 'menu.attack');
  return (
    <span className={styles.order} title={label}>
      <Glyph size={14} aria-hidden="true" />
      <span className={styles.orderDot} style={{ background: color }} />
    </span>
  );
}

/**
 * Одно тревожное состояние армии в фиксированном месте карточки, по важности: котёл, истощение,
 * бой, наступление без продвижения («упёрлись»). Остальные видны в подсказках.
 */
function alertOf(stats: ArmyStats, stuck: boolean): React.JSX.Element | null {
  if (stats.encircled > 0) {
    return (
      <span title={t('army.encircled')}>
        <Icon name="encircled" className={styles.encircledIcon} />
      </span>
    );
  }
  if (stats.starving > 0) {
    return (
      <span title={t('army.starving').replace('{n}', String(stats.starving))}>
        <Icon name="warn" className={styles.alarmIcon} />
      </span>
    );
  }
  if (stats.fighting) {
    return (
      <span title={t('army.fighting')}>
        <Icon name="fighting" className={styles.fightingIcon} />
      </span>
    );
  }
  if (stuck) {
    return (
      <span title={t('army.stuck')} className={styles.stuckIcon}>
        <IconHourglass size={18} aria-hidden="true" />
      </span>
    );
  }
  return null;
}

function ArmyCard(props: {
  rawName: string;
  name: string;
  color: string;
  stats: ArmyStats;
  /** Звёзды опыта армии 0..3. */
  stars: number;
  /** Предел армии (заказанная численность): рядом с числом солдат; нет — лимита нет. */
  wanted?: number | undefined;
  /** Приказ армии: режим и цель (id игрока или −1); нет — приказа нет. */
  dir?: ArmyView['dir'] | undefined;
  /** Армия в морском десанте. */
  sea?: boolean | undefined;
  /** Наступление армии стоит без продвижения — значок «упёрлись». */
  stuck: boolean;
  selected: boolean;
  /** Выбрана часть отрядов армии — тонкая рамка (07-controls.md, «Что выбрано»). */
  partial: boolean;
  onRename: (name: string) => void;
  onClick: () => void;
  /** ПКМ: если выбраны отряды — перевести их в эту армию, иначе выбрать армию. */
  onContextAction: () => void;
  onDoubleClick?: () => void;
}): React.JSX.Element {
  const { stats } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.rawName);
  const frame = props.selected ? styles.selected : props.partial ? styles.partial : '';
  // Переименование — двойным кликом по названию; двойной клик по остальной карточке — к армии.
  const beginEditing = (event: React.MouseEvent): void => {
    event.stopPropagation();
    setDraft(props.rawName);
    setEditing(true);
  };
  const save = (): void => {
    props.onRename(normalizeArmyName(draft));
    setEditing(false);
  };
  const cancel = (): void => setEditing(false);
  const select = (): void => props.onClick();
  const selectFromContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    props.onContextAction();
  };
  return (
    <div className={`${styles.card} ${frame}`} data-tutorial="army-card">
      <div
        role="button"
        tabIndex={0}
        className={styles.pick}
        aria-pressed={props.selected}
        title={`${formatSoldiers(stats.soldiers)} ${t('unit.soldiers')}`}
        onClick={select}
        onDoubleClick={props.onDoubleClick}
        onContextMenu={selectFromContextMenu}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') select();
        }}
      >
        <span className={styles.band} style={{ background: props.color }} />
        <span className={styles.body}>
          <span className={styles.head}>
            {editing ? (
              <input
                className={styles.nameInput}
                value={draft}
                maxLength={MAX_ARMY_NAME_LENGTH}
                aria-label={t('army.rename')}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onBlur={save}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') save();
                  if (event.key === 'Escape') cancel();
                }}
              />
            ) : (
              <span className={styles.nameText} onDoubleClick={beginEditing}>
                {props.name}
              </span>
            )}
            <span className={styles.slotOrder}>
              <OrderBadge dir={props.dir} sea={props.sea} />
            </span>
            <span className={styles.slotAlert}>{alertOf(props.stats, props.stuck)}</span>
          </span>
          <span className={styles.countRow}>
            <RollNumber
              kind="main"
              className={styles.count}
              value={stats.soldiers}
              text={formatSoldiers(stats.soldiers)}
            />
            {props.wanted !== undefined && (
              <RollNumber
                kind="limit"
                className={styles.limitText}
                value={props.wanted}
                text={`→ ${formatSoldiers(props.wanted * FP)}`}
                title={t('army.limit')}
              />
            )}
            <span className={styles.slotStars}>
              {props.stars > 0 && (
                <span className={styles.stars} title={t('army.stars')}>
                  {Array.from({ length: props.stars }, (_, i) => (
                    <IconStarFilled key={i} size={12} aria-hidden="true" />
                  ))}
                </span>
              )}
            </span>
          </span>
        </span>
        <span className={styles.bars}>
          <Meter
            label="army.org"
            share={stats.org}
            color={
              stats.org < OFFENSIVE_STOP_ORG / ORG_MAX ? tokens.status.danger : tokens.chip.org
            }
          />
          <Meter
            label="army.supply"
            share={stats.supply}
            color={supplyColor(stats.supply, stats.starving > 0)}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * Панель армий как в HoI4 (07-controls.md, «Панель армий», CR-005): внизу карточки армий
 * (закладка цвета, название, организация, снабжение), над выбранной — приказы иконками.
 */
export function ArmyBar(props: {
  view: PlayerView;
  selected: number | null;
  /** Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке. */
  partial: readonly number[];
  /** Выбранные сейчас отряды (для ПКМ по карточке армии). */
  pickedUnits: readonly number[];
  onSelect: (armyId: number | null) => void;
  onFocusArmy?: (armyId: number) => void;
  /** Номера занятых групп управления — значки-цифры. */
  groups?: readonly number[];
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  /** Включён выбор страны для «Держать» на карте. */
  holdPicking: boolean;
  /** Включает выбор страны для «Держать» у армии; null — выключает. */
  onHoldPick: (armyId: number | null) => void;
  /** Начать морское вторжение армией: выбор порта, затем гекса высадки. */
  onInvade?: (armyId: number) => void;
  /** Идёт выбор вторжения. */
  invading?: boolean;
  /** Высота нижней панели (тулбар + карточки), px: карточки гекса и отряда встают над ней. */
  onHeight?: (px: number) => void;
  /** Высота панели приказов над карточками (с отступом), px; 0 — панели нет. */
  onToolsHeight?: (px: number) => void;
  /** Панель приказов скрыта: на телефоне её место занимает окно «Постройки». */
  hideTools?: boolean;
  style?: React.CSSProperties | undefined;
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // Армий больше, чем влезает: появляется настоящая полоса прокрутки (иначе лента не перехватывает нажатия).
  const [overflow, setOverflow] = useState(false);
  const [compAnchor, setCompAnchor] = useState<DOMRect | null>(null);
  const [stepPct, setStepPct] = useState<StepPct>(readStep);
  const chooseStep = (pct: StepPct): void => {
    setStepPct(pct);
    try {
      localStorage.setItem(STEP_KEY, String(pct));
    } catch {
      // Хранилище закрыто: выбор шага действует до перезагрузки.
    }
  };
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = (): void => setOverflow(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    if (strip.firstElementChild) ro.observe(strip.firstElementChild);
    return () => ro.disconnect();
  }, []);
  const { onHeight, onToolsHeight } = props;
  // Панель приказов на узком экране переносится на две строки: окна над ней сдвигаются на её высоту.
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsShown = props.selected !== null && props.hideTools !== true;
  useLayoutEffect(() => {
    const el = toolsRef.current;
    if (!el || !onToolsHeight) {
      onToolsHeight?.(0);
      return;
    }
    const report = (): void => onToolsHeight(Math.ceil(el.getBoundingClientRect().height) + 8);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onToolsHeight(0);
    };
  }, [onToolsHeight, toolsShown]);
  useLayoutEffect(() => {
    // Высота всей нижней панели вместе с отступами: от неё считаются кнопки режимов и окна над ней.
    const content = contentRef.current;
    const dock = content?.parentElement;
    if (!content || !dock || !onHeight) return;
    const report = (): void => onHeight(Math.ceil(dock.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(dock);
    ro.observe(content);
    return () => ro.disconnect();
  }, [onHeight]);
  const { view, send, selected } = props;
  const mine = view.units.filter((u) => u.owner === view.playerId);
  // Тулбар — у выбранной армии; у единственной частично выбранной — тоже, но без инструментов
  // планов (07-controls.md, «Что выбрано»).
  const only = props.partial.length === 1 ? props.partial[0] : undefined;
  const army = view.armies.find((a) => a.id === (selected ?? only));
  // «Наступать» — по всем фронтам армии с воюющей страной (цель приказа); без войны серая.
  const warWith = (target: number): boolean =>
    target >= 0 && (view.diplomacy?.relations[target] ?? 'war') === 'war';
  const attackBlocked = (a: ArmyView): string | null =>
    a.dir !== undefined && warWith(a.dir.target) ? null : t('army.attackNeedWar');
  const attackArmy = (a: ArmyView): void => {
    if (a.dir === undefined || !warWith(a.dir.target)) return;
    send({
      t: 'launchOffensive',
      target: a.dir.target,
      ...orderFields(armyCounts(view, a), a.id),
    });
  };
  // «Держать»: наступающая армия переходит в оборону на ту же цель; без приказа (или на ничьей
  // земле) включается выбор страны на карте.
  const holdArmy = (a: ArmyView): void => {
    if (a.dir?.mode === 'attack' && a.dir.target >= 0) {
      send({ t: 'holdBorder', target: a.dir.target, ...orderFields(armyCounts(view, a), a.id) });
      return;
    }
    props.onHoldPick(props.holdPicking ? null : a.id);
  };
  // Уровни размера армии (рота…корпус) — доли предела государства, а не число.
  const soldiersOf = (a: ArmyView): number =>
    Math.floor(mine.filter((u) => u.armyId === a.id).reduce((sum, u) => sum + u.soldiers, 0) / FP);
  const sizeOf = (a: ArmyView): number => armySize(a, soldiersOf(a));
  const limitMax = maxArmySoldiers(view);
  // «Усилить» считает от большего из предела и фактической численности, чтобы не уменьшить.
  const baseSize = (a: ArmyView, dir: 1 | -1): number =>
    dir === 1 ? Math.max(sizeOf(a), soldiersOf(a)) : sizeOf(a);
  const resizeBlocked = (a: ArmyView, dir: 1 | -1): string | null =>
    stepSize(baseSize(a, dir), stepPct, dir, limitMax) === baseSize(a, dir)
      ? t(dir === 1 ? 'army.strongest' : 'army.weakest')
      : null;
  const resize = (a: ArmyView, dir: 1 | -1): void => {
    const next = stepSize(baseSize(a, dir), stepPct, dir, limitMax);
    const counts = countsFromShares(next, sharesFromCounts(armyCounts(view, a)));
    const mix = counts.armor + counts.artillery > 0 ? counts : undefined;
    send(limitCommand(a, next, mix && { armor: mix.armor, artillery: mix.artillery }));
  };
  const select = (armyId: number, units: readonly UnitView[]): void => {
    const off = armyId === selected;
    props.onSelect(off ? null : armyId);
    props.onPick({ hex: null, units: off ? [] : units.map((u) => u.id), target: null });
  };
  const onStripWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += delta;
  };
  const reserve = mine.filter((u) => u.armyId === null);
  // Выбранная армия всегда в видимой части ленты, даже если её выбрали на карте или клавишей.
  useEffect(() => {
    // Лента листается сама, страница — нет: scrollIntoView сдвинул бы весь интерфейс вверх.
    const strip = stripRef.current;
    const card = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !card) return;
    const from = card.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    if (from.left < box.left) strip.scrollLeft += from.left - box.left;
    else if (from.right > box.right) strip.scrollLeft += from.right - box.right;
  }, [selected]);
  return (
    <div className={styles.dock} style={props.style}>
      <div className={styles.content} ref={contentRef}>
        {army && props.hideTools !== true && (
          <div ref={toolsRef} className={styles.tools} role="toolbar" aria-label={armyName(army)}>
            <Tool
              glyph={<IconShield size={18} aria-hidden="true" />}
              tutorial="army-hold"
              label="menu.hold"
              onClick={() => holdArmy(army)}
              active={props.holdPicking || army.dir?.mode === 'hold'}
            />
            <Tool
              glyph={<IconSwords size={18} aria-hidden="true" />}
              tutorial="army-attack"
              label="menu.attack"
              onClick={() => attackArmy(army)}
              active={army.dir?.mode === 'attack'}
              disabled={attackBlocked(army)}
            />
            <Tool
              glyph={<IconMinus size={18} aria-hidden="true" />}
              label="army.weaker"
              onClick={() => resize(army, -1)}
              disabled={resizeBlocked(army, -1)}
            />
            <StepPlus
              step={stepPct}
              onStep={chooseStep}
              onPlus={() => resize(army, 1)}
              disabled={resizeBlocked(army, 1)}
              cost={armyResizeCost(view, army, stepSize(baseSize(army, 1), stepPct, 1, limitMax))}
              tutorial="army-stronger"
              limit={{ next: stepSize(baseSize(army, 1), stepPct, 1, limitMax), max: limitMax }}
            />
            <Tool
              glyph={<IconAdjustmentsHorizontal size={18} aria-hidden="true" />}
              tutorial="army-limit"
              label="army.composition"
              onClick={(event) => setCompAnchor(event.currentTarget.getBoundingClientRect())}
              active={compAnchor !== null}
            />
            {props.onInvade && (
              <Tool
                glyph={<IconAnchor size={18} aria-hidden="true" />}
                tutorial="army-invade"
                label="army.invade"
                onClick={() => props.onInvade?.(army.id)}
                active={props.invading === true}
              />
            )}
            <Tool
              icon="split"
              tutorial="army-split"
              label="army.split"
              onClick={() => send({ t: 'splitArmy', armyId: army.id })}
              disabled={
                mine.filter((u) => u.armyId === army.id).length < 2 ? t('army.splitNeedTwo') : null
              }
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
        {props.groups && props.groups.length > 0 && (
          <ul className={styles.groups} aria-label={t('army.groups')}>
            {props.groups.map((digit) => (
              <li key={digit}>{digit}</li>
            ))}
          </ul>
        )}
        {army && compAnchor && (
          <ArmyLimit
            anchor={compAnchor}
            value={sizeOf(army)}
            shares={sharesFromCounts(armyCounts(view, army))}
            onApply={(soldiers, counts) => {
              const mix = counts.armor + counts.artillery > 0 ? counts : undefined;
              send(
                limitCommand(army, soldiers, mix && { armor: mix.armor, artillery: mix.artillery }),
              );
            }}
            onClose={() => setCompAnchor(null)}
          />
        )}
        <div className={styles.stripRow}>
          {/* Резерв и «новая армия» стоят слева и не уезжают вместе с лентой карточек. */}
          <div className={styles.reserve}>
            <IconButton
              type="button"
              className={styles.iconButton}
              label={t('army.reserve')}
              onClick={() =>
                props.onPick({ hex: null, units: reserve.map((u) => u.id), target: null })
              }
            >
              <Icon name="reserve" />
              <span className={styles.num}>
                {formatSoldiers(reserve.reduce((sum, u) => sum + u.soldiers, 0))}
              </span>
            </IconButton>
            <IconButton
              type="button"
              className={styles.iconButton}
              label={t('army.new')}
              onClick={() => send({ t: 'createArmy', name: '' })}
            >
              <Icon name="add" />
            </IconButton>
          </div>
          <div
            ref={stripRef}
            className={styles.strip}
            data-overflow={overflow}
            onWheel={onStripWheel}
          >
            <div className={styles.stripContent}>
              {view.armies.map((a) => {
                const units = mine.filter((u) => u.armyId === a.id);
                return (
                  <ArmyCard
                    key={a.id}
                    name={armyName(a)}
                    rawName={a.name}
                    color={armyColor(a.number)}
                    stats={armyStats(units)}
                    stars={a.stars ?? 0}
                    wanted={a.wanted}
                    dir={a.dir}
                    sea={a.sea}
                    stuck={view.plans.some(
                      (p) => p.armyId === a.id && p.kind === 'front' && p.stuck,
                    )}
                    selected={a.id === selected}
                    partial={props.partial.includes(a.id)}
                    onRename={(name) => send({ t: 'renameArmy', armyId: a.id, name })}
                    onClick={() => select(a.id, units)}
                    onContextAction={() => {
                      const ids = props.pickedUnits.filter((id) => mine.some((u) => u.id === id));
                      if (ids.length > 0 && !ids.every((id) => units.some((u) => u.id === id))) {
                        send({ t: 'assignUnits', unitIds: ids, armyId: a.id });
                      } else {
                        select(a.id, units);
                      }
                    }}
                    onDoubleClick={() => props.onFocusArmy?.(a.id)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
