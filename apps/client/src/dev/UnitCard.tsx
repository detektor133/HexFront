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
import type { Picked } from './sandbox-selection.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatPercent, formatSoldiers } from '../i18n/format.ts';
import { armyColor } from '../theme/colors.ts';

function Row(props: { label: string; value: string }): React.JSX.Element {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

function Button(props: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <div className={styles.action}>
      <button type="button" className={styles.button} onClick={props.onClick}>
        <span>{props.label}</span>
      </button>
    </div>
  );
}

// Иконка «Слить» 20×20 (линия 2, round): два пути сходятся в один (art/ui.md, иконки действий).
function MergeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className={styles.icon} aria-hidden="true">
      <polyline points="4,4 10,10 16,4" />
      <line x1="10" y1="10" x2="10" y2="17" />
    </svg>
  );
}

// Действие одной иконкой: подпись — во всплывающей подсказке и для экранного диктора.
function IconButton(props: {
  label: string;
  icon: React.JSX.Element;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.action}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={props.label}
        title={props.label}
        onClick={props.onClick}
      >
        {props.icon}
      </button>
    </div>
  );
}

// «В армию» — плашки армий с закладкой цвета и «Резерв»; плашка армии, где сейчас все выбранные
// отряды, в золотой рамке. Тап — перевести отряды (assignUnits).
function ArmyPlates(props: {
  units: readonly UnitView[];
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element {
  const { units, view, send } = props;
  const ids = units.map((u) => u.id);
  const current = units.every((u) => u.armyId === units[0]?.armyId) ? units[0]?.armyId : undefined;
  const plate = (armyId: number | null, label: string, color: string | null): React.JSX.Element => (
    <button
      key={armyId ?? 'reserve'}
      type="button"
      className={`${styles.plate} ${current === armyId ? styles.plateOn : ''}`}
      aria-pressed={current === armyId}
      onClick={() => send({ t: 'assignUnits', unitIds: ids, armyId })}
    >
      {color && <span className={styles.plateBand} style={{ background: color }} />}
      <span>{label}</span>
    </button>
  );
  return (
    <div className={styles.plates} role="group" aria-label={t('unit.toArmy')}>
      {view.armies.map((a) => plate(a.id, armyName(a), armyColor(a.number)))}
      {plate(null, t('army.reserve'), null)}
    </div>
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

// Приказы выбранным отрядам: слить, в армию, фокус огня. Деление — только
// вытягиванием из фишки (05-armies.md), кнопки «Разделить» нет.
function Orders(props: {
  units: readonly UnitView[];
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element {
  const { units, view, send } = props;
  const ids = units.map((u) => u.id);
  const [first] = units;
  const sameStack =
    units.length > 1 && units.every((u) => u.hex === first?.hex && u.type === first?.type);
  return (
    <>
      {sameStack && (
        <IconButton
          label={t('unit.merge')}
          icon={<MergeIcon />}
          onClick={() => send({ t: 'merge', unitIds: ids })}
        />
      )}
      {units.length === 1 && first?.type === 'artillery' && (
        <Button
          label={t('unit.autoTarget')}
          onClick={() => send({ t: 'bombard', unitId: first.id, targetUnitId: null })}
        />
      )}
      <ArmyPlates units={units} view={view} send={send} />
    </>
  );
}

/** Карточка выбранных отрядов песочницы: состав и приказы (атака — без подтверждения, 04/T16). */
export function UnitCard(props: {
  view: PlayerView;
  map: MapStatic;
  picked: Picked;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
}): React.JSX.Element | null {
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
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      {units.length === 1 && <UnitRows u={first} view={view} />}
      <Orders units={units} view={view} send={props.send} />
    </section>
  );
}
