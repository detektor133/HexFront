import { IconArrowsJoin2, IconScissors, IconX } from '@tabler/icons-react';
import { useLayoutEffect, useRef } from 'react';

import {
  FP,
  MAX_UNITS_PER_HEX,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import styles from './HexCard.module.css';
import { armyName } from './army-name.ts';
import { measureCardHeight } from './card-measurement.ts';
import { toggleUnitSelection, type Picked } from './sandbox-selection.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatPercent, formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';
import { IconButton } from '../ui/icon-button.tsx';
import { MetricRow } from '../ui/metric-icon.tsx';

function Row(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div title={props.label}>
      <dd>{props.value}</dd>
    </div>
  );
}

function UnitRows(props: { u: UnitView; view: PlayerView }): React.JSX.Element {
  const { u, view } = props;
  const army = view.armies.find((a) => a.id === u.armyId);
  return (
    <dl className={styles.stats}>
      <MetricRow name="organization" value={formatFp(u.org)} />
      <MetricRow
        name="supply"
        value={u.encircled ? t('unit.encircled') : formatPercent(u.supplyLevel ?? (FP as Fp))}
      />
      <Row label={t('unit.order')} value={t(`order.${u.order}` as MessageKey)} />
      <Row label={t('unit.army')} value={army ? armyName(army) : t('army.reserve')} />
    </dl>
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
    <p
      role="status"
      aria-label={t(key)}
      className={key === 'unit.artilleryNoTarget' ? styles.bad : styles.good}
    >
      {t(key)}
    </p>
  ) : null;
}

/** Карточка выбранных отрядов песочницы: состав и приказы (атака — без подтверждения, 04/T16). */
export function UnitCard(props: {
  view: PlayerView;
  map: MapStatic;
  picked: Picked;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
  onHeight?: (px: number) => void;
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
    .filter((u): u is UnitView => u !== undefined);
  const [first] = units;
  if (!first) return null;
  const mergeReason: MessageKey | null =
    units.length < 2
      ? 'unit.mergeNeedMore'
      : units.some((unit) => unit.owner !== view.playerId)
        ? 'unit.mergeNotOwn'
        : units.some((unit) => unit.order === 'retreat')
          ? 'reason.retreating'
          : units.some((unit) => unit.type !== first.type)
            ? 'unit.mergeDifferentTypes'
            : units.some((unit) => unit.hex !== first.hex)
              ? 'unit.mergeDifferentHexes'
              : null;
  const splitReason: MessageKey | null =
    units.length !== 1
      ? null
      : first.owner !== view.playerId
        ? 'reason.notOwnUnit'
        : first.soldiers < 2 * FP
          ? 'unit.splitNeedMore'
          : first.order === 'retreat'
            ? 'reason.retreating'
            : view.units.filter((unit) => unit.owner === view.playerId && unit.hex === first.hex)
                  .length >= MAX_UNITS_PER_HEX
              ? 'reason.hexFull'
              : null;
  const title =
    units.length === 1
      ? `${t(`unit.${first.type}` as MessageKey)} · ${formatSoldiers(first.soldiers)}`
      : t('unit.groups');
  const selectedGroups = units.reduce<Map<number | null, UnitView[]>>((result, unit) => {
    const group = result.get(unit.armyId) ?? [];
    group.push(unit);
    result.set(unit.armyId, group);
    return result;
  }, new Map());
  const groups = [...selectedGroups.keys()].map(
    (armyId) =>
      [
        armyId,
        view.units.filter((unit) => unit.owner === view.playerId && unit.armyId === armyId),
      ] as const,
  );
  const orderedGroups = groups.sort(([left], [right]) => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    const leftNumber = view.armies.find((army) => army.id === left)?.number ?? left;
    const rightNumber = view.armies.find((army) => army.id === right)?.number ?? right;
    return leftNumber - rightNumber;
  });
  for (const [, group] of orderedGroups) group.sort((left, right) => left.id - right.id);
  return (
    <section ref={cardRef} className={styles.card} style={props.style} aria-label={title}>
      <div ref={contentRef} className={styles.cardBody}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton
            className={styles.iconButton}
            label={t('unit.close')}
            onClick={() => props.onPick({ hex: null, units: [], target: null })}
          >
            <IconX className={styles.icon} size={16} aria-hidden="true" />
          </IconButton>
        </div>
        {units.length === 1 && <UnitRows u={first} view={view} />}
        {units.length === 1 && <ArtilleryStatus unit={first} />}
        {units.length > 1 && (
          <div className={styles.unitGroups}>
            {orderedGroups.map(([armyId, group]) => {
              const army =
                armyId === null ? undefined : view.armies.find((item) => item.id === armyId);
              const selectableGroup = group;
              return (
                <section className={styles.unitGroup} key={armyId ?? 'reserve'}>
                  <h3 className={styles.groupTitle}>
                    <button
                      type="button"
                      aria-pressed={
                        selectableGroup.length > 0 &&
                        selectableGroup.every((unit) => picked.units.includes(unit.id))
                      }
                      disabled={selectableGroup.length === 0}
                      aria-label={army ? armyName(army) : t('army.reserve')}
                      onClick={() =>
                        props.onPick(
                          toggleUnitSelection(
                            view,
                            picked,
                            selectableGroup.map((unit) => unit.id),
                          ),
                        )
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={styles.armyMarker}
                        data-army-number={army?.number}
                        style={{ backgroundColor: army ? armyColor(army.number) : undefined }}
                      />
                      {army ? army.number : t('army.reserve')}
                    </button>
                  </h3>
                  <ul className={styles.unitList}>
                    {group.map((unit) => {
                      const army =
                        unit.armyId === null
                          ? undefined
                          : view.armies.find((item) => item.id === unit.armyId);
                      const armyLabel = army ? armyName(army) : t('army.reserve');
                      const label = `${t(`unit.${unit.type}` as MessageKey)} · ${formatSoldiers(unit.soldiers)} · ${armyLabel}`;
                      return (
                        <li key={unit.id}>
                          <IconButton
                            className={styles.unitPlate}
                            label={label}
                            aria-pressed={picked.units.includes(unit.id)}
                            onClick={() =>
                              props.onPick(toggleUnitSelection(view, picked, [unit.id]))
                            }
                          >
                            <UnitGlyph className={styles.unitGlyph} type={unit.type} />
                            <span>{formatSoldiers(unit.soldiers)}</span>
                          </IconButton>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {units.length === 1 && (
          <>
            <IconButton
              className={`${styles.button} ${styles.iconAction}`}
              label={t('unit.split')}
              disabled={splitReason !== null}
              onClick={() =>
                props.send({
                  t: 'split',
                  unitId: first.id,
                  soldiers: (Math.floor(first.soldiers / (2 * FP)) * FP) as Fp,
                })
              }
            >
              <IconScissors className={styles.icon} size={16} aria-hidden="true" />
            </IconButton>
            {splitReason && <p role="status">{t(splitReason)}</p>}
          </>
        )}
        {mergeReason ? (
          <p role="status">{t(mergeReason)}</p>
        ) : units.length > 1 ? (
          <IconButton
            className={`${styles.button} ${styles.iconAction}`}
            label={t('unit.merge')}
            onClick={() => props.send({ t: 'merge', unitIds: units.map((unit) => unit.id) })}
          >
            <IconArrowsJoin2 className={styles.icon} size={16} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </section>
  );
}
