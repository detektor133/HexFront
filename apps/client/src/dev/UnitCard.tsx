import { IconArrowsJoin2, IconPlayerStop, IconScissors, IconX } from '@tabler/icons-react';
import { useLayoutEffect, useRef } from 'react';

import {
  FP,
  MAX_UNITS_PER_HEX,
  type ArmyView,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitType,
  type UnitView,
} from '@hexfront/sim';

import styles from './UnitCard.module.css';
import { armyName } from './army-name.ts';
import { measureCardHeight } from './card-measurement.ts';
import type { Picked } from './sandbox-selection.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatCompact } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';
import { IconButton } from '../ui/icon-button.tsx';

const TYPE_ORDER: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

/** Строки окна: род войск, солдаты (сокращённо) и число отрядов этого рода. */
function TypeRows(props: { readonly units: readonly UnitView[] }): React.JSX.Element {
  return (
    <ul className={styles.rows}>
      {TYPE_ORDER.map((type) => {
        const of = props.units.filter((u) => u.type === type);
        if (of.length === 0) return null;
        const soldiers = of.reduce((sum, u) => sum + u.soldiers, 0);
        const label = t(`unit.${type}` as MessageKey);
        return (
          <li key={type} className={styles.row} title={label}>
            <span className={styles.badge}>
              <UnitGlyph className={styles.glyph} type={type} />
            </span>
            <span className={styles.rowName}>{label}</span>
            <span className={styles.soldiers}>{formatCompact(soldiers)}</span>
            <span className={styles.count} title={t('unit.count')}>
              {'×' + String(of.length)}
            </span>
          </li>
        );
      })}
    </ul>
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

/** Группа окна: армия (или резерв), выбранные отряды и сколько всего отрядов в армии. */
interface Group {
  readonly key: string;
  readonly army: ArmyView | null;
  readonly shown: readonly UnitView[];
  readonly total: number;
}

/** По карточке на армию (или резерв): в ней только выбранные отряды. */
function groupsOf(view: PlayerView, units: readonly UnitView[]): readonly Group[] {
  const armyIds = [...new Set(units.map((u) => u.armyId))];
  return armyIds
    .sort((a, b) => (a ?? -1) - (b ?? -1))
    .map((id) => ({
      key: String(id),
      army: id === null ? null : (view.armies.find((a) => a.id === id) ?? null),
      shown: units.filter((u) => u.armyId === id),
      total:
        id === null
          ? units.filter((u) => u.armyId === null).length
          : view.units.filter((u) => u.owner === view.playerId && u.armyId === id).length,
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
    : [{ key: 'foreign', army: null, shown: units, total: units.length }];
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
            <TypeRows units={group.shown} />
            {mine && group.shown.length < group.total && (
              <p className={styles.partial}>
                {t('unit.selectedOf')
                  .replace('{n}', String(group.shown.length))
                  .replace('{m}', String(group.total))}
              </p>
            )}
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
