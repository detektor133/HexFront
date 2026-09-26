// Прогноз боя по снимку игрока — до подтверждения атаки.
// GDD: docs/gdd/06-combat.md — «Прогноз боя».
import { CASUALTY_RATE, FORECAST_MARGIN } from '../balance.ts';
import {
  attackPower,
  defensePower,
  orgLossPerS,
  type Fighter,
  type Ground,
} from './battle-math.ts';
import type { PlayerView } from './player-view.ts';
import type { UnitView } from './unit-view.ts';
import type { MapStatic } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import type { MatchState, Unit } from '../state/types.ts';

export type ForecastOutcome = 'victory' | 'defeat' | 'stalemate';

/** Прогноз: исход, время до слома стороны и потери сторон долями. */
export interface Forecast {
  readonly outcome: ForecastOutcome;
  /** Секунды до слома первой стороны, fixed-point. */
  readonly timeS: Fp;
  /** Доля солдат, которую потеряет сторона, fixed-point 0..1. */
  readonly attackerLoss: Fp;
  readonly defenderLoss: Fp;
  /** Сила сторон, fixed-point «солдат-эквивалентов». */
  readonly attack: number;
  readonly defense: number;
}

// Неизвестная снабжённость чужого отряда считается полной.
const fighter = (u: UnitView): Combatant => ({ ...u, supplyLevel: u.supplyLevel ?? (FP as Fp) });

interface Side {
  readonly soldiers: number;
  readonly avgOrg: Fp;
}

// Солдаты стороны и средневзвешенная по солдатам организованность (с ополчением города).
function side(
  units: readonly { soldiers: number; org: number }[],
  militia = 0,
  militiaOrg = 0,
): Side {
  let soldiers = militia;
  let orgWeighted = militia * militiaOrg;
  for (const u of units) {
    soldiers += u.soldiers;
    orgWeighted += u.soldiers * u.org;
  }
  return { soldiers, avgOrg: (soldiers > 0 ? intDiv(orgWeighted, soldiers) : 0) as Fp };
}

const INSTANT: Omit<Forecast, 'attack'> = {
  outcome: 'victory',
  timeS: 0 as Fp,
  attackerLoss: 0 as Fp,
  defenderLoss: 0 as Fp,
  defense: 0,
};

// Доля потерь стороны: скорость потерь × время / солдаты, не больше 1.
function lossShare(enemyPower: number, timeS: Fp, soldiers: number): Fp {
  if (soldiers <= 0) return 0 as Fp;
  const lost = fpMul(fpMul(enemyPower as Fp, CASUALTY_RATE), timeS);
  return Math.min(FP, fpDiv(lost, soldiers as Fp)) as Fp;
}

type Combatant = Fighter & { readonly org: number };

/** Входные данные прогноза: бойцы сторон, оборона города, все отряды (для поддержки артиллерии). */
interface ForecastInput {
  readonly ground: Ground;
  readonly attackers: readonly Combatant[];
  readonly defenders: readonly Combatant[];
  readonly city: { readonly defenders: Fp; readonly defenseOrg: Fp } | null;
  readonly all: readonly Fighter[];
  readonly target: HexId;
}

// Общая формула прогноза для снимка игрока и для состояния матча (06-combat.md, «Прогноз боя»).
function forecastCore(f: ForecastInput): Forecast {
  const attack = attackPower(f.ground.map, f.attackers, f.target, f.all);
  // Пустой гекс или одинокая артиллерия без ополчения — гекс берётся сразу.
  if (!f.city && f.defenders.every((u) => u.type === 'artillery')) return { ...INSTANT, attack };
  const defense = defensePower(f.ground, f.defenders, f.city?.defenders ?? (0 as Fp), f.target);
  const att = side(f.attackers);
  const def = side(f.defenders, f.city?.defenders ?? 0, f.city?.defenseOrg ?? 0);
  const tDef = fpDiv(def.avgOrg, orgLossPerS(attack, defense) as Fp);
  const tAtt = fpDiv(att.avgOrg, orgLossPerS(defense, attack) as Fp);
  let outcome: ForecastOutcome = 'stalemate';
  if (tDef < fpMul(tAtt, FORECAST_MARGIN)) outcome = 'victory';
  else if (tAtt < fpMul(tDef, FORECAST_MARGIN)) outcome = 'defeat';
  const timeS = Math.min(tDef, tAtt) as Fp;
  return {
    outcome,
    timeS,
    attackerLoss: lossShare(defense, timeS, att.soldiers),
    defenderLoss: lossShare(attack, timeS, def.soldiers),
    attack,
    defense,
  };
}

/**
 * Прогноз боя за гекс target отрядами unitIds по видимым данным игрока:
 * tDef = org защитников / потеря org защитников в секунду, tAtt — так же для атакующих;
 * tDef < tAtt × FORECAST_MARGIN → «победа», tAtt < tDef × FORECAST_MARGIN → «поражение»,
 * иначе «упорный бой». Невидимые отряды не учитываются, чужое снабжение = 100 %.
 */
export function forecastBattle(
  map: MapStatic,
  view: PlayerView,
  unitIds: readonly number[],
  target: HexId,
): Forecast {
  const me = view.playerId;
  const city = view.cities.find(
    (c) => c.hex === target && c.owner !== me && c.defenders > 0 && c.defenseOrg > 0,
  );
  return forecastCore({
    ground: {
      map,
      building: view.hexes.building,
      hasCity: (hex) => view.cities.some((c) => c.hex === hex),
    },
    attackers: view.units.filter((u) => unitIds.includes(u.id) && u.owner === me).map(fighter),
    defenders: view.units.filter((u) => u.hex === target && u.owner !== me).map(fighter),
    city: city ?? null,
    all: view.units.map(fighter),
    target,
  });
}

/**
 * Прогноз боя по полному состоянию матча — для шагов наступления армий (07-controls.md).
 * @returns тот же прогноз, что показывает интерфейс, но по настоящим данным
 */
export function forecastInState(
  state: MatchState,
  attackers: readonly Unit[],
  target: HexId,
): Forecast {
  const owner = attackers[0]?.owner ?? -1;
  const city = state.cities.find(
    (c) => c.hex === target && c.owner !== owner && c.defenders > 0 && c.defenseOrg > 0,
  );
  return forecastCore({
    ground: {
      map: state.map,
      building: state.hexes.building,
      hasCity: (hex) => state.cities.some((c) => c.hex === hex),
    },
    attackers,
    defenders: state.units.filter((u) => u.hex === target && u.owner !== owner),
    city: city ?? null,
    all: state.units,
    target,
  });
}
