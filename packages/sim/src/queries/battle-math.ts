// Формулы боя, общие для combatSystem и прогноза: сила сторон, фланги, потеря org.
// GDD: docs/gdd/06-combat.md — «Сила сторон», «Потери и организованность».
import {
  ARTY_RANGE,
  ARTY_SUPPORT_BONUS,
  ARTY_SUPPORT_MIN_SOLDIERS,
  ATK,
  CITY_DEF_MULT,
  DEF,
  DEF_MULT,
  FLANK_MAX,
  FLANK_STEP,
  FORT_DEF_MULT,
  FORT_DEF_MULTS,
  ORG_LOSS_K,
  ORG_LOSS_MAX,
  ORG_LOSS_MIN,
  RIVER_ATTACK_MULT,
  SUPPLY_COMBAT_BASE,
  type UnitType,
} from '../balance.ts';
import { TERRAIN_NAMES, type MapStatic } from '../map/types.ts';
import { hexDistanceById, hexFromId, neighbors, type HexId } from '../math/hex.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import { fortLevel } from '../state/fort.ts';
import type { UnitOrder } from '../state/types.ts';
import { powerPct } from '../systems/experience.ts';

/** Множитель силы от звёзд опыта: 1 + бонус звёзд. */
function starMult(stars: number | undefined): Fp {
  return (FP + intDiv(FP * powerPct(stars), 100)) as Fp;
}

/** Боец для формул: отряд из состояния или из снимка игрока. */
export interface Fighter {
  readonly owner: number;
  readonly type: UnitType;
  readonly soldiers: Fp;
  readonly supplyLevel: Fp;
  readonly hex: HexId;
  readonly order: UnitOrder;
  /** Звёзды опыта армии 0..3; нет поля — ноль. */
  readonly stars?: number | undefined;
}

/** Минимум полей отряда для проверки поддержки артиллерией (подходит и отряду снимка). */
export type Supporter = Pick<Fighter, 'owner' | 'type' | 'soldiers' | 'hex' | 'order'>;

/** Местность боя: карта, постройки гексов и признак города на гексе. */
export interface Ground {
  readonly map: MapStatic;
  readonly building: ArrayLike<number>;
  readonly hasCity: (hex: HexId) => boolean;
}

/** Множитель снабжения в бою: SUPPLY_COMBAT_BASE + (1 − SUPPLY_COMBAT_BASE) × s. */
export function supplyCombatMult(supplyLevel: Fp): Fp {
  return (SUPPLY_COMBAT_BASE + fpMul((FP - SUPPLY_COMBAT_BASE) as Fp, supplyLevel)) as Fp;
}

/**
 * Множитель флангов: 1 + FLANK_STEP × (направлений − 1), не больше FLANK_MAX.
 * @returns fixed-point множитель
 */
export function flankMultiplier(directions: number): Fp {
  return Math.min(FLANK_MAX, FP + FLANK_STEP * (directions - 1)) as Fp;
}

/** Направление ребра from→to (индекс соседа) или -1, если гексы не соседи. */
export function hexDirection(map: MapStatic, from: HexId, to: HexId): number {
  const t = hexFromId(to, map.width);
  return neighbors(hexFromId(from, map.width)).findIndex((n) => n.q === t.q && n.r === t.r);
}

// Своя артиллерия (≥ ARTY_SUPPORT_MIN_SOLDIERS, не отступает) в радиусе ARTY_RANGE от цели.
export function isSupportedByArtillery(
  map: MapStatic,
  all: readonly Supporter[],
  owner: number,
  hex: HexId,
): boolean {
  return all.some(
    (a) =>
      a.owner === owner &&
      a.type === 'artillery' &&
      a.order !== 'retreat' &&
      a.soldiers >= ARTY_SUPPORT_MIN_SOLDIERS &&
      hexDistanceById(a.hex, hex, map.width) <= ARTY_RANGE,
  );
}

/**
 * Вклад отряда в атаку до флангов: soldiers × ATK × supplyMult, × RIVER_ATTACK_MULT через реку,
 * × ARTY_SUPPORT_BONUS при поддержке своей артиллерии (один раз, без сложения).
 * @returns fixed-point «солдат-эквивалентов»
 */
export function attackContribution(
  map: MapStatic,
  f: Fighter,
  hex: HexId,
  all: readonly Supporter[],
): number {
  return contribution(map, f, hex, () => isSupportedByArtillery(map, all, f.owner, hex));
}

// Вклад с ленивой проверкой поддержки: attackPower считает её раз на владельца, а не на отряд.
function contribution(map: MapStatic, f: Fighter, hex: HexId, supported: () => boolean): number {
  let base = fpMul(
    fpMul(fpMul(f.soldiers, ATK[f.type]), supplyCombatMult(f.supplyLevel)),
    starMult(f.stars),
  );
  const dir = hexDirection(map, f.hex, hex);
  if (dir >= 0 && ((map.rivers[f.hex] ?? 0) >> dir) & 1)
    base = fpMul(base as Fp, RIVER_ATTACK_MULT);
  return supported() ? fpMul(base as Fp, ARTY_SUPPORT_BONUS) : base;
}

/**
 * Атака = Σ вкладов × множитель флангов.
 * @returns fixed-point «солдат-эквивалентов»
 */
export function attackPower(
  map: MapStatic,
  attackers: readonly Fighter[],
  hex: HexId,
  all: readonly Supporter[],
): number {
  const support = new Map<number, boolean>();
  const supportOf = (owner: number): boolean => {
    let value = support.get(owner);
    if (value === undefined) {
      value = isSupportedByArtillery(map, all, owner, hex);
      support.set(owner, value);
    }
    return value;
  };
  const raw = attackers.reduce(
    (sum, f) => sum + contribution(map, f, hex, () => supportOf(f.owner)),
    0,
  );
  const dirs = new Set(attackers.map((f) => hexDirection(map, f.hex, hex)));
  return fpMul(raw as Fp, flankMultiplier(dirs.size));
}

/**
 * Оборона = (Σ soldiers × DEF × supplyMult + ополчение × DEF пехоты) × местность × укрепление
 * × город.
 * @returns fixed-point «солдат-эквивалентов»
 */
export function defensePower(
  ground: Ground,
  defenders: readonly Fighter[],
  militia: Fp,
  hex: HexId,
): number {
  let raw: number = fpMul(militia, DEF.infantry);
  for (const f of defenders) {
    raw += fpMul(
      fpMul(fpMul(f.soldiers, DEF[f.type]), supplyCombatMult(f.supplyLevel)),
      starMult(f.stars),
    );
  }
  const name = TERRAIN_NAMES[ground.map.terrain[hex] ?? 0];
  let mult = (name === undefined || name === 'water' ? FP : DEF_MULT[name]) as Fp;
  const fort = fortLevel(ground.building[hex] ?? 0);
  if (fort > 0) mult = fpMul(mult, FORT_DEF_MULTS[fort - 1] ?? FORT_DEF_MULT);
  if (ground.hasCity(hex)) mult = fpMul(mult, CITY_DEF_MULT);
  return fpMul(raw as Fp, mult);
}

/**
 * Потеря организованности стороны в секунду: clamp(ORG_LOSS_K × враг / свои, MIN, MAX).
 * @returns fixed-point org в секунду
 */
export function orgLossPerS(enemy: number, own: number): number {
  if (own <= 0) return ORG_LOSS_MAX;
  return Math.min(
    ORG_LOSS_MAX,
    Math.max(ORG_LOSS_MIN, fpMul(ORG_LOSS_K, fpDiv(enemy as Fp, own as Fp))),
  );
}
