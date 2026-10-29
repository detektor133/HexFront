import { useLayoutEffect, useRef } from 'react';

import {
  FP,
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
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatPercent, formatSoldiers } from '../i18n/format.ts';
import { IconButton } from '../ui/icon-button.tsx';

function Row(props: { label: string; value: string }): React.JSX.Element {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

function UnitRows(props: { u: UnitView; view: PlayerView }): React.JSX.Element {
  const { u, view } = props;
  const army = view.armies.find((a) => a.id === u.armyId);
  return (
    <dl className={styles.stats}>
      <Row label={t('unit.org')} value={formatFp(u.org)} />
      <Row
        label={t('unit.supply')}
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
        view.units.filter(
          (unit) =>
            unit.owner === view.playerId && unit.order !== 'retreat' && unit.armyId === armyId,
        ),
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
            <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </IconButton>
        </div>
        {units.length === 1 && <UnitRows u={first} view={view} />}
        {units.length === 1 && <ArtilleryStatus unit={first} />}
        {units.length > 1 && (
          <div className={styles.unitGroups}>
            {orderedGroups.map(([armyId, group]) => {
              const army =
                armyId === null ? undefined : view.armies.find((item) => item.id === armyId);
              return (
                <section className={styles.unitGroup} key={armyId ?? 'reserve'}>
                  <h3 className={styles.groupTitle}>
                    <button
                      type="button"
                      aria-pressed={group.every((unit) => picked.units.includes(unit.id))}
                      onClick={() =>
                        props.onPick(
                          toggleUnitSelection(
                            view,
                            picked,
                            group.map((unit) => unit.id),
                          ),
                        )
                      }
                    >
                      {army ? armyName(army) : t('army.reserve')}
                    </button>
                  </h3>
                  <ul className={styles.unitList}>
                    {group.map((unit) => (
                      <li key={unit.id}>
                        <button
                          type="button"
                          aria-pressed={picked.units.includes(unit.id)}
                          onClick={() => props.onPick(toggleUnitSelection(view, picked, [unit.id]))}
                        >
                          {t(`unit.${unit.type}` as MessageKey)} · {formatSoldiers(unit.soldiers)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
