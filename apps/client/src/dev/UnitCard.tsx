import { IconArrowsJoin2, IconPlayerStop, IconScissors, IconX } from '@tabler/icons-react';
import { useLayoutEffect, useRef } from 'react';

import {
  FP,
  MAX_UNITS_PER_HEX,
  ORG_MAX,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import styles from './UnitCard.module.css';
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
  onClick?: (() => void) | undefined;
}): React.JSX.Element {
  const { u, view } = props;
  const army = view.armies.find((a) => a.id === u.armyId);
  const org = Math.max(0, Math.min(1, u.org / ORG_MAX));
  const supply = Math.max(0, Math.min(1, (u.supplyLevel ?? FP) / FP));
  const label = `${t(`unit.${u.type}` as MessageKey)} · ${formatSoldiers(u.soldiers)}`;
  return (
    <button
      type="button"
      className={styles.plate}
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

/** Окно выбранных отрядов: список плашек и ряд маленьких кнопок (разделить, слить/собрать, стоп). */
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
    .filter((u): u is UnitView => u !== undefined)
    .sort((a, b) => a.id - b.id);
  const [first] = units;
  if (!first) return null;
  const mine = units.every((u) => u.owner === view.playerId);
  const mergeable =
    first.armyId !== null &&
    units.every((u) => u.hex === first.hex && u.type === first.type && u.armyId === first.armyId);
  const mergeReason: MessageKey | null = units.some((u) => u.order === 'retreat')
    ? 'reason.retreating'
    : null;
  const splitReason: MessageKey | null =
    units.length !== 1
      ? null
      : first.soldiers < 2 * FP
        ? 'unit.splitNeedMore'
        : first.order === 'retreat'
          ? 'reason.retreating'
          : view.units.filter((u) => u.owner === view.playerId && u.hex === first.hex).length >=
              MAX_UNITS_PER_HEX
            ? 'reason.hexFull'
            : null;
  const gathering = units.find((u) => (u.gather ?? -1) >= 0)?.gather;
  const title = units.length === 1 ? t(`unit.${first.type}` as MessageKey) : t('unit.groups');
  const tip = (base: MessageKey, reason: MessageKey | null): string =>
    reason ? `${t(base)}: ${t(reason)}` : t(base);
  return (
    <section ref={cardRef} className={styles.card} style={props.style} aria-label={title}>
      <div ref={contentRef} className={styles.body}>
        <IconButton
          className={styles.close}
          label={t('unit.close')}
          onClick={() => props.onPick({ hex: null, units: [], target: null })}
        >
          <IconX size={14} aria-hidden="true" />
        </IconButton>
        <div className={styles.list}>
          {units.map((u) => (
            <UnitPlate
              key={u.id}
              u={u}
              view={view}
              onClick={
                units.length > 1
                  ? () => props.onPick({ hex: null, units: [u.id], target: null })
                  : undefined
              }
            />
          ))}
        </div>
        {units.length === 1 && <ArtilleryStatus unit={first} />}
        {gathering !== undefined && (
          <p role="status" className={styles.note}>
            {t('unit.gathering')} {gathering % props.map.width}·
            {Math.floor(gathering / props.map.width)}
          </p>
        )}
        {mine && (
          <div className={styles.actions}>
            {units.length === 1 && (
              <IconButton
                className={styles.action}
                label={tip('unit.split', splitReason)}
                disabled={splitReason !== null}
                onClick={() =>
                  props.send({
                    t: 'split',
                    unitId: first.id,
                    soldiers: (Math.floor(first.soldiers / (2 * FP)) * FP) as Fp,
                  })
                }
              >
                <IconScissors size={18} aria-hidden="true" />
              </IconButton>
            )}
            {units.length > 1 && (
              <IconButton
                className={styles.action}
                label={tip(mergeable ? 'unit.merge' : 'unit.gather', mergeReason)}
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
            )}
            <IconButton
              className={styles.action}
              label={t('unit.stop')}
              onClick={() => props.send({ t: 'stop', unitIds: units.map((u) => u.id) })}
            >
              <IconPlayerStop size={18} aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  );
}
