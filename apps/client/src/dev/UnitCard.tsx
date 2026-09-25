import {
  forecastBattle,
  FP,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import styles from './HexCard.module.css';
import { armyName } from './army-name.ts';
import { attackCommand, type Picked } from './sandbox-selection.ts';
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

function Button(props: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <div className={styles.action}>
      <button type="button" className={styles.button} onClick={props.onClick}>
        <span>{props.label}</span>
      </button>
    </div>
  );
}

// Прогноз до подтверждения атаки (06-combat.md, «Прогноз боя»): «Победа · потери ~12 % · 8 с».
function Forecast(props: {
  map: MapStatic;
  view: PlayerView;
  picked: Picked;
  send: (cmd: Command) => void;
  onPick: (p: Picked) => void;
}): React.JSX.Element | null {
  const { map, view, picked } = props;
  if (picked.target === null) return null;
  const f = forecastBattle(map, view, picked.units, picked.target);
  const cmd = attackCommand(view, picked);
  const cls = f.outcome === 'victory' ? styles.good : f.outcome === 'defeat' ? styles.bad : '';
  return (
    <>
      <p className={cls}>
        {t(`forecast.${f.outcome}` as MessageKey)} · {t('forecast.losses')} ~
        {formatPercent(f.attackerLoss)} · {formatFp(f.timeS)} {t('card.seconds')}
      </p>
      {cmd && (
        <Button
          label={t('forecast.attack')}
          onClick={() => {
            props.send(cmd);
            props.onPick({ ...picked, target: null });
          }}
        />
      )}
      <Button
        label={t('forecast.cancel')}
        onClick={() => props.onPick({ ...picked, target: null })}
      />
    </>
  );
}

function UnitRows(props: { u: UnitView; view: PlayerView }): React.JSX.Element {
  const { u, view } = props;
  const army = view.armies.find((a) => a.id === u.armyId);
  return (
    <dl className={styles.stats}>
      <Row label={t('unit.soldiers')} value={formatSoldiers(u.soldiers)} />
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

// Приказы выбранным отрядам: держать, экспансия, разделить, слить, в армию, фокус огня.
function Orders(props: {
  units: readonly UnitView[];
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element {
  const { units, view, send } = props;
  const ids = units.map((u) => u.id);
  const [first] = units;
  const noArtillery = units.every((u) => u.type !== 'artillery');
  const sameStack =
    units.length > 1 && units.every((u) => u.hex === first?.hex && u.type === first?.type);
  return (
    <>
      <Button
        label={t('unit.hold')}
        onClick={() => send({ t: 'setOrder', unitIds: ids, order: 'hold' })}
      />
      {noArtillery && (
        <Button
          label={t('unit.expand')}
          onClick={() => send({ t: 'setOrder', unitIds: ids, order: 'expand' })}
        />
      )}
      {units.length === 1 && first && first.soldiers >= 2 * FP && (
        <Button
          label={t('unit.split')}
          onClick={() =>
            send({
              t: 'split',
              unitId: first.id,
              soldiers: (Math.floor(first.soldiers / 2 / FP) * FP) as Fp,
            })
          }
        />
      )}
      {sameStack && (
        <Button label={t('unit.merge')} onClick={() => send({ t: 'merge', unitIds: ids })} />
      )}
      {units.length === 1 && first?.type === 'artillery' && (
        <Button
          label={t('unit.autoTarget')}
          onClick={() => send({ t: 'bombard', unitId: first.id, targetUnitId: null })}
        />
      )}
      <label className={styles.hint}>
        {t('unit.toArmy')}{' '}
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            send({ t: 'assignUnits', unitIds: ids, armyId: v === 'reserve' ? null : Number(v) });
          }}
        >
          <option value="">—</option>
          <option value="reserve">{t('army.reserve')}</option>
          {view.armies.map((a) => (
            <option key={a.id} value={a.id}>
              {armyName(a)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Карточка выбранных отрядов песочницы: состав, приказы, прогноз перед атакой. */
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
      <p className={styles.hint}>{t('unit.hintOrder')}</p>
      <Forecast {...props} />
      {picked.target === null && <Orders units={units} view={view} send={props.send} />}
      <Button
        label={t('unit.clear')}
        onClick={() => props.onPick({ ...picked, units: [], target: null })}
      />
    </section>
  );
}
