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
const fighter = (u: UnitView): Fighter => ({ ...u, supplyLevel: u.supplyLevel ?? (FP as Fp) });

interface Side {
  readonly soldiers: number;
  readonly avgOrg: Fp;
}

// Солдаты стороны и средневзвешенная по солдатам организованность (с ополчением города).
function side(units: readonly UnitView[], militia = 0, militiaOrg = 0): Side {
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
  const attackers = view.units.filter((u) => unitIds.includes(u.id) && u.owner === me);
  const defenders = view.units.filter((u) => u.hex === target && u.owner !== me);
  const city = view.cities.find(
    (c) => c.hex === target && c.owner !== me && c.defenders > 0 && c.defenseOrg > 0,
  );
  const all = view.units.map(fighter);
  const attack = attackPower(map, attackers.map(fighter), target, all);
  // Пустой гекс или одинокая артиллерия без ополчения — гекс берётся сразу.
  if (!city && defenders.every((u) => u.type === 'artillery')) return { ...INSTANT, attack };
  const ground: Ground = {
    map,
    building: view.hexes.building,
    hasCity: (hex) => view.cities.some((c) => c.hex === hex),
  };
  const defense = defensePower(
    ground,
    defenders.map(fighter),
    city?.defenders ?? (0 as Fp),
    target,
  );
  const att = side(attackers);
  const def = side(defenders, city?.defenders ?? 0, city?.defenseOrg ?? 0);
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
