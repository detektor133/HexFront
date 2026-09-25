// Бой: сила сторон, потери, организованность, отступления, захват гекса.
// GDD: docs/gdd/06-combat.md — «Сила сторон», «Потери и организованность», «Исход».
import {
  ATK,
  CASUALTY_RATE,
  CITY_DEF_MULT,
  DEF,
  DEF_MULT,
  FLANK_MAX,
  FLANK_STEP,
  FORT_DEF_MULT,
  ORG_LOSS_K,
  ORG_LOSS_MAX,
  ORG_LOSS_MIN,
  RETREAT_DAMAGE_TAKEN_MULT,
  RIVER_ATTACK_MULT,
  SUPPLY_COMBAT_BASE,
  TICKS_PER_S,
} from '../balance.ts';
import { TERRAIN_NAMES } from '../map/types.ts';
import { hexFromId, neighbors, type HexId } from '../math/hex.ts';
import { FP, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';
import { captureHex } from '../state/capture.ts';
import { retreatOrCapitulate } from '../state/retreat.ts';
import { BUILDING, type City, type MatchState, type Unit } from '../state/types.ts';

/** Множитель снабжения в бою: SUPPLY_COMBAT_BASE + (1 − SUPPLY_COMBAT_BASE) × s. */
export function supplyCombatMult(supplyLevel: Fp): Fp {
  return (SUPPLY_COMBAT_BASE + fpMul((FP - SUPPLY_COMBAT_BASE) as Fp, supplyLevel)) as Fp;
}

// Направление ребра from→to или -1, если гексы не соседи.
function direction(state: MatchState, from: HexId, to: HexId): number {
  const { width } = state.map;
  const t = hexFromId(to, width);
  return neighbors(hexFromId(from, width)).findIndex((n) => n.q === t.q && n.r === t.r);
}

function attackersOf(state: MatchState, hex: HexId): Unit[] {
  return state.units.filter(
    (u) => u.order === 'attack' && u.target === hex && direction(state, u.hex, hex) >= 0,
  );
}

// Оборона города: ополчение или гарнизон, пока есть солдаты и организованность.
function activeCity(state: MatchState, hex: HexId, attacker: number): City | null {
  const city = state.cities.find((c) => c.hex === hex);
  if (!city || city.owner === attacker || city.defenders <= 0 || city.defenseOrg <= 0) return null;
  return city;
}

/** Вклад отряда в атаку до флангов: soldiers × ATK × supplyMult (× 0,7 через реку). */
function attackOf(state: MatchState, u: Unit, hex: HexId): number {
  const base = fpMul(fpMul(u.soldiers, ATK[u.type]), supplyCombatMult(u.supplyLevel));
  const dir = direction(state, u.hex, hex);
  const river = dir >= 0 && ((state.map.rivers[u.hex] ?? 0) >> dir) & 1;
  return river ? fpMul(base as Fp, RIVER_ATTACK_MULT) : base;
}

/**
 * Множитель флангов: 1 + FLANK_STEP × (направлений − 1), не больше FLANK_MAX.
 * @returns fixed-point множитель
 */
export function flankMultiplier(directions: number): Fp {
  return Math.min(FLANK_MAX, FP + FLANK_STEP * (directions - 1)) as Fp;
}

function flankMult(state: MatchState, attackers: readonly Unit[], hex: HexId): Fp {
  return flankMultiplier(new Set(attackers.map((u) => direction(state, u.hex, hex))).size);
}

function defenseMult(state: MatchState, hex: HexId): Fp {
  const name = TERRAIN_NAMES[state.map.terrain[hex] ?? 0];
  let mult = (name === undefined || name === 'water' ? FP : DEF_MULT[name]) as Fp;
  if (state.hexes.building[hex] === BUILDING.fort) mult = fpMul(mult, FORT_DEF_MULT);
  if (state.cities.some((c) => c.hex === hex)) mult = fpMul(mult, CITY_DEF_MULT);
  return mult;
}

interface Battle {
  readonly hex: HexId;
  readonly attackers: Unit[];
  readonly defenders: Unit[];
  readonly city: City | null;
  readonly attack: number;
  readonly defense: number;
}

function battleAt(state: MatchState, hex: HexId): Battle | null {
  const attackers = attackersOf(state, hex);
  const first = attackers[0];
  if (!first) return null;
  const defenders = state.units.filter((u) => u.hex === hex && u.owner !== first.owner);
  const city = activeCity(state, hex, first.owner);
  if (defenders.length === 0 && !city) return null;
  const rawAttack = attackers.reduce((sum, u) => sum + attackOf(state, u, hex), 0);
  let rawDefense = city ? fpMul(city.defenders, DEF.infantry) : 0;
  for (const u of defenders) {
    rawDefense += fpMul(fpMul(u.soldiers, DEF[u.type]), supplyCombatMult(u.supplyLevel));
  }
  return {
    hex,
    attackers,
    defenders,
    city,
    attack: fpMul(rawAttack as Fp, flankMult(state, attackers, hex)),
    defense: fpMul(rawDefense as Fp, defenseMult(state, hex)),
  };
}

/**
 * Сила сторон боя за гекс по текущему состоянию.
 * @returns fixed-point «солдат-эквивалентов» атаки и обороны; нули, если боя нет
 */
export function battlePowers(state: MatchState, hex: HexId): { attack: number; defense: number } {
  const b = battleAt(state, hex);
  return { attack: b?.attack ?? 0, defense: b?.defense ?? 0 };
}

/** Потеря org в секунду: clamp(ORG_LOSS_K × враг / свои, ORG_LOSS_MIN, ORG_LOSS_MAX). */
function orgLossPerS(enemy: number, own: number): number {
  if (own <= 0) return ORG_LOSS_MAX;
  return Math.min(
    ORG_LOSS_MAX,
    Math.max(ORG_LOSS_MIN, fpMul(ORG_LOSS_K, fpDiv(enemy as Fp, own as Fp))),
  );
}

interface Hit {
  soldiers: number;
  org: number;
}

function addHit(
  hits: Map<Unit | City, Hit>,
  key: Unit | City,
  soldiers: number,
  org: number,
): void {
  const h = hits.get(key) ?? { soldiers: 0, org: 0 };
  h.soldiers += soldiers;
  h.org = Math.max(h.org, org);
  hits.set(key, h);
}

// Потери за тик делятся по солдатам; отступающий под атакой теряет × RETREAT_DAMAGE_TAKEN_MULT.
function collectHits(b: Battle, hits: Map<Unit | City, Hit>): void {
  const attLoss = intDiv(fpMul(b.defense as Fp, CASUALTY_RATE), TICKS_PER_S);
  const defLoss = intDiv(fpMul(b.attack as Fp, CASUALTY_RATE), TICKS_PER_S);
  const attOrg = intDiv(orgLossPerS(b.defense, b.attack), TICKS_PER_S);
  const defOrg = intDiv(orgLossPerS(b.attack, b.defense), TICKS_PER_S);
  const attTotal = b.attackers.reduce((s, u) => s + u.soldiers, 0);
  for (const u of b.attackers) addHit(hits, u, intDiv(attLoss * u.soldiers, attTotal), attOrg);
  const defTotal = b.defenders.reduce((s, u) => s + u.soldiers, b.city?.defenders ?? 0);
  if (defTotal <= 0) return;
  for (const u of b.defenders) {
    const share = intDiv(defLoss * u.soldiers, defTotal);
    const mult = u.order === 'retreat' ? RETREAT_DAMAGE_TAKEN_MULT : FP;
    addHit(hits, u, fpMul(share as Fp, mult as Fp), defOrg);
  }
  if (b.city) addHit(hits, b.city, intDiv(defLoss * b.city.defenders, defTotal), defOrg);
}

function applyHits(hits: Map<Unit | City, Hit>): void {
  for (const [key, h] of hits) {
    if ('defenders' in key) {
      key.defenders = Math.max(0, key.defenders - h.soldiers) as Fp;
      key.defenseOrg = Math.max(0, key.defenseOrg - h.org) as Fp;
      key.inBattle = true;
    } else {
      key.soldiers = Math.max(0, key.soldiers - h.soldiers) as Fp;
      key.org = Math.max(0, key.org - h.org) as Fp;
      key.inBattle = true;
    }
  }
}

// Уничтожение, отступление сломленных защитников, остановка сломленных атакующих.
function resolveUnits(state: MatchState, battles: readonly Battle[]): void {
  const attackerHexes = new Map<Unit, HexId[]>();
  for (const b of battles) {
    for (const d of b.defenders)
      attackerHexes.set(
        d,
        b.attackers.map((a) => a.hex),
      );
  }
  const survivors: Unit[] = [];
  for (const u of state.units) {
    if (u.soldiers <= 0) {
      state.events.push({ t: 'unitDestroyed', playerId: u.owner, unitId: u.id });
      continue;
    }
    const hexes = attackerHexes.get(u);
    if (hexes && u.org <= 0 && u.order !== 'retreat' && !retreatOrCapitulate(state, u, hexes)) {
      continue;
    }
    if (u.order === 'attack' && u.org <= 0) {
      u.order = 'idle';
      u.target = -1;
    }
    survivors.push(u);
  }
  state.units.splice(0, state.units.length, ...survivors);
}

// Гекс без защитников: сильнейший атакующий сразу входит и захватывает его, остальные встают.
function occupy(state: MatchState, hex: HexId): void {
  const attackers = attackersOf(state, hex).filter((u) => u.org > 0);
  const first = attackers[0];
  if (!first) return;
  if (state.units.some((u) => u.hex === hex && u.owner !== first.owner)) return;
  if (activeCity(state, hex, first.owner)) return;
  let winner = first;
  for (const u of attackers) if (attackOf(state, u, hex) > attackOf(state, winner, hex)) winner = u;
  const city = state.cities.find((c) => c.hex === hex && c.owner !== winner.owner);
  winner.hex = hex;
  captureHex(state, hex, winner.owner);
  if (city) state.events.push({ t: 'cityCaptured', playerId: winner.owner, cityId: city.id });
  for (const u of attackersOf(state, hex).concat(winner)) {
    u.order = 'idle';
    u.target = -1;
  }
}

/** Все бои тика: потери и org одновременно для всех боёв, затем исходы и захваты. */
export function combatSystem(state: MatchState): void {
  for (const u of state.units) u.inBattle = false;
  for (const c of state.cities) c.inBattle = false;
  const targets = [
    ...new Set(state.units.filter((u) => u.order === 'attack').map((u) => u.target)),
  ];
  targets.sort((a, b) => a - b);
  const battles: Battle[] = [];
  for (const hex of targets) {
    const b = battleAt(state, hex);
    if (b) battles.push(b);
  }
  const hits = new Map<Unit | City, Hit>();
  for (const b of battles) collectHits(b, hits);
  applyHits(hits);
  resolveUnits(state, battles);
  for (const hex of targets) occupy(state, hex);
  // Цель стала своей или ушла из соседей — атака снимается.
  for (const u of state.units) {
    if (u.order !== 'attack') continue;
    if (state.hexes.owner[u.target] === u.owner || direction(state, u.hex, u.target) < 0) {
      u.order = 'idle';
      u.target = -1;
    }
  }
}
