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
import type { Picked } from './sandbox-selection.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatPercent, formatSoldiers } from '../i18n/format.ts';

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
  const total = units.reduce((s, u) => s + u.soldiers, 0);
  const title =
    units.length === 1
      ? `${t(`unit.${first.type}` as MessageKey)} · ${formatSoldiers(first.soldiers)}`
      : `${t('unit.selected')}: ${units.length} · ${formatSoldiers(total)}`;
  return (
    <section ref={cardRef} className={styles.card} style={props.style} aria-label={title}>
      <div ref={contentRef} className={styles.cardBody}>
        <h2 className={styles.title}>{title}</h2>
        {units.length === 1 && <UnitRows u={first} view={view} />}
        {units.length === 1 && <ArtilleryStatus unit={first} />}
      </div>
    </section>
  );
}
