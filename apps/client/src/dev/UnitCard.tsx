import { IconArrowsJoin2, IconPlayerStop, IconScissors, IconX } from '@tabler/icons-react';
import { useLayoutEffect, useRef } from 'react';

import {
  FP,
  MAX_UNITS_PER_HEX,
  ORG_MAX,
  type ArmyView,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import styles from './UnitCard.module.css';
import { armyName } from './army-name.ts';
import { measureCardHeight } from './card-measurement.ts';
import type { Picked } from './sandbox-selection.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Плашка отряда как фишка на карте: знак цвета армии, число солдат, столбики организации и снабжения. */
function UnitPlate(props: {
  u: UnitView;
  view: PlayerView;
  /** Отряд выбран на карте: золотая рамка, как у фишки. */
  selected?: boolean;
  onClick?: ((event: React.MouseEvent) => void) | undefined;
}): React.JSX.Element {
  const { u, view } = props;
  const army = view.armies.find((a) => a.id === u.armyId);
  const org = Math.max(0, Math.min(1, u.org / ORG_MAX));
  const supply = Math.max(0, Math.min(1, (u.supplyLevel ?? FP) / FP));
  const label = `${t(`unit.${u.type}` as MessageKey)} · ${formatSoldiers(u.soldiers)}`;
  return (
    <button
      type="button"
      className={`${styles.plate} ${props.selected ? styles.plateSelected : ''}`}
      aria-pressed={props.selected ?? false}
      title={label}
      aria-label={label}
      onClick={props.onClick}
    >
      <span
        className={styles.badge}
        style={army ? { background: armyColor(army.number) } : undefined}
      >
        <UnitGlyph className={styles.glyph} type={u.type} />
      </span>
      <span className={styles.soldiers}>{formatSoldiers(u.soldiers)}</span>
      <span className={styles.bars} aria-hidden="true">
        <span className={styles.track}>
          <span className={styles.fill} style={{ height: `${org * 100}%` }} />
        </span>
        <span className={styles.track}>
          <span
            className={styles.fill}
            data-kind={u.encircled || supply < 0.5 ? 'low' : 'supply'}
            style={{ height: `${supply * 100}%` }}
          />
        </span>
      </span>
    </button>
  );
}

function ArtilleryStatus({ unit }: { unit: UnitView }): React.JSX.Element | null {
  const key: MessageKey | null =
    unit.type === 'artillery'
      ? unit.fireTarget >= 0
        ? 'unit.artilleryFiring'
        : 'unit.artilleryNoTarget'
      : unit.artillerySupport
        ? 'unit.artillerySupport'
        : null;
  return key ? (
    <p role="status" className={styles.note} data-bad={key === 'unit.artilleryNoTarget'}>
      {t(key)}
    </p>
  ) : null;
}

/** Группа окна: армия (или резерв) и отряды, которые в ней показываются. */
interface Group {
  readonly key: string;
  readonly army: ArmyView | null;
  readonly shown: readonly UnitView[];
}

/** Одна армия — полный список её отрядов; несколько армий или резерв — только выбранные, по карточке на армию. */
function groupsOf(view: PlayerView, units: readonly UnitView[]): readonly Group[] {
  const armyIds = [...new Set(units.map((u) => u.armyId))];
  const byId = (id: number | null): ArmyView | null =>
    id === null ? null : (view.armies.find((a) => a.id === id) ?? null);
  const only = armyIds.length === 1 ? armyIds[0] : undefined;
  if (only !== undefined && only !== null) {
    const all = view.units
      .filter((u) => u.owner === view.playerId && u.armyId === only)
      .sort((a, b) => a.id - b.id);
    return [{ key: String(only), army: byId(only), shown: all }];
  }
  return armyIds
    .sort((a, b) => (a ?? -1) - (b ?? -1))
    .map((id) => ({
      key: String(id),
      army: byId(id),
      shown: units.filter((u) => u.armyId === id),
    }));
}

/**
 * Окно отрядов (как в HoI4). Выбраны отряды одной армии — постоянный список всех её отрядов,
 * выбранные подсвечены. Выбраны отряды из разных армий (или резерва) — отдельная карточка на каждую
 * армию, в ней только выбранные отряды. Внизу всегда кнопки: разделить (каждый выбранный отряд
 * пополам), слить, стоп.
 */
export function UnitCard(props: {
  view: PlayerView;
  map: MapStatic;
  picked: Picked;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  onHeight?: (px: number) => void;
  /** Окно закрывается: плавно гаснет и не принимает нажатий. */
  closing?: boolean;
  style?: React.CSSProperties | undefined;
}): React.JSX.Element | null {
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !props.onHeight) return;
    const card = cardRef.current;
    if (!card) return;
    const report = (entries: readonly ResizeObserverEntry[]): void =>
      props.onHeight?.(measureCardHeight(card, content, entries[0]));
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  }, [props.onHeight]);
  const { view, picked } = props;
  const units = picked.units
    .map((id) => view.units.find((u) => u.id === id))
    .filter((u): u is UnitView => u !== undefined)
    .sort((a, b) => a.id - b.id);
  const [first] = units;
  if (!first) return null;
  const mine = units.every((u) => u.owner === view.playerId);
  const groups: readonly Group[] = mine
    ? groupsOf(view, units)
    : [{ key: 'foreign', army: null, shown: units }];
  const selectedIds = new Set(units.map((u) => u.id));
  const mergeable =
    first.armyId !== null &&
    units.every((u) => u.hex === first.hex && u.type === first.type && u.armyId === first.armyId);
  const retreating = units.some((u) => u.order === 'retreat');
  const mergeReason: MessageKey | null = retreating
    ? 'reason.retreating'
    : units.length < 2
      ? 'unit.mergeNeedTwo'
      : null;
  // Делится каждый выбранный отряд, которому хватает солдат и места в гексе; остальные пропускаются.
  const splittable = units.filter(
    (u) =>
      u.soldiers >= 2 * FP &&
      u.order !== 'retreat' &&
      view.units.filter((x) => x.owner === view.playerId && x.hex === u.hex).length <
        MAX_UNITS_PER_HEX,
  );
  const splitReason: MessageKey | null =
    splittable.length > 0 ? null : retreating ? 'reason.retreating' : 'unit.splitNeedMore';
  const gathering = units.find((u) => (u.gather ?? -1) >= 0)?.gather;
  const title = units.length === 1 ? t(`unit.${first.type}` as MessageKey) : t('unit.groups');
  const tip = (base: MessageKey, reason: MessageKey | null): string =>
    reason ? `${t(base)}: ${t(reason)}` : t(base);
  // Нажатие по плашке: выбрать только этот отряд; Ctrl/⌘ — добавить или снять; повторное нажатие
  // по единственному выбранному выбирает все отряды армии.
  const clickPlate = (u: UnitView, group: Group, event: React.MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      const next = selectedIds.has(u.id) ? units.filter((x) => x.id !== u.id) : [...units, u];
      props.onPick({ hex: null, units: next.map((x) => x.id), target: null });
      return;
    }
    const alone = selectedIds.size === 1 && selectedIds.has(u.id);
    props.onPick({
      hex: null,
      units: (alone ? group.shown : [u]).map((x) => x.id),
      target: null,
    });
  };
  const actions = mine ? (
    <div className={styles.actions}>
      <IconButton
        className={styles.action}
        label={tip('unit.split', splitReason)}
        disabled={splitReason !== null}
        onClick={() => {
          for (const u of splittable) {
            props.send({
              t: 'split',
              unitId: u.id,
              soldiers: (Math.floor(u.soldiers / (2 * FP)) * FP) as Fp,
            });
          }
        }}
      >
        <IconScissors size={18} aria-hidden="true" />
      </IconButton>
      <IconButton
        className={styles.action}
        label={tip(mergeable || units.length < 2 ? 'unit.merge' : 'unit.gather', mergeReason)}
        disabled={mergeReason !== null}
        onClick={() =>
          props.send({
            t: mergeable ? 'merge' : 'gather',
            unitIds: units.map((u) => u.id),
          })
        }
      >
        <IconArrowsJoin2 size={18} aria-hidden="true" />
      </IconButton>
      <IconButton
        className={styles.action}
        label={t('unit.stop')}
        onClick={() => props.send({ t: 'stop', unitIds: units.map((u) => u.id) })}
      >
        <IconPlayerStop size={18} aria-hidden="true" />
      </IconButton>
    </div>
  ) : null;
  return (
    <section
      ref={cardRef}
      className={`${styles.stack} ${props.closing ? styles.closing : ''}`}
      style={props.style}
      aria-label={title}
    >
      <div ref={contentRef} className={styles.body}>
        {groups.map((group, index) => (
          <div key={group.key} className={styles.card}>
            {index === 0 && (
              <IconButton
                className={styles.close}
                label={t('unit.close')}
                onClick={() => props.onPick({ hex: null, units: [], target: null })}
              >
                <IconX size={14} aria-hidden="true" />
              </IconButton>
            )}
            {mine && (
              <div className={styles.head}>
                <span
                  className={styles.swatch}
                  style={{ background: group.army ? armyColor(group.army.number) : 'transparent' }}
                />
                <span className={styles.headName}>
                  {group.army ? armyName(group.army) : t('army.reserve')}
                </span>
              </div>
            )}
            <div className={styles.list}>
              {group.shown.map((u) => (
                <UnitPlate
                  key={u.id}
                  u={u}
                  view={view}
                  selected={mine && selectedIds.has(u.id)}
                  onClick={mine ? (event) => clickPlate(u, group, event) : undefined}
                />
              ))}
            </div>
            {index === groups.length - 1 && (
              <>
                {units.length === 1 && <ArtilleryStatus unit={first} />}
                {gathering !== undefined && (
                  <p role="status" className={styles.note}>
                    {t('unit.gathering')} {gathering % props.map.width}·
                    {Math.floor(gathering / props.map.width)}
                  </p>
                )}
                {actions}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
