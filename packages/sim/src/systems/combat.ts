// Бой: потери, организованность, отступления, захват гекса. Формулы силы — queries/battle-math.
// GDD: docs/gdd/06-combat.md — «Сила сторон», «Потери и организованность», «Исход».
import {
  ARTY_FLEE_LOSS,
  CASUALTY_RATE,
  RETREAT_DAMAGE_TAKEN_MULT,
  TICKS_PER_S,
} from '../balance.ts';
import type { HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import {
  attackContribution,
  attackPower,
  defensePower,
  hexDirection,
  orgLossPerS,
  type Ground,
} from '../queries/battle-math.ts';
import { captureHex } from '../state/capture.ts';
import { retreatOrCapitulate } from '../state/retreat.ts';
import type { City, MatchState, Unit } from '../state/types.ts';

export { flankMultiplier, supplyCombatMult } from '../queries/battle-math.ts';

function direction(state: MatchState, from: HexId, to: HexId): number {
  return hexDirection(state.map, from, to);
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

function groundOf(state: MatchState): Ground {
  return {
    map: state.map,
    building: state.hexes.building,
    hasCity: (hex) => state.cities.some((c) => c.hex === hex),
  };
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
  return {
    hex,
    attackers,
    defenders,
    city,
    attack: attackPower(state.map, attackers, hex, state.units),
    defense: defensePower(groundOf(state), defenders, city?.defenders ?? (0 as Fp), hex),
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
  const power = (u: Unit): number => attackContribution(state.map, u, hex, state.units);
  for (const u of attackers) if (power(u) > power(winner)) winner = u;
  const city = state.cities.find((c) => c.hex === hex && c.owner !== winner.owner);
  winner.hex = hex;
  captureHex(state, hex, winner.owner);
  if (city) state.events.push({ t: 'cityCaptured', playerId: winner.owner, cityId: city.id });
  for (const u of attackersOf(state, hex).concat(winner)) {
    u.order = 'idle';
    u.target = -1;
  }
}

// Артиллерия одна в атакованном гексе (без других отрядов и ополчения) сразу отступает
// с потерей ARTY_FLEE_LOSS (06-combat.md, «Уязвимость»).
function fleeLoneArtillery(state: MatchState, hex: HexId): void {
  const attackers = attackersOf(state, hex);
  const first = attackers[0];
  if (!first || activeCity(state, hex, first.owner)) return;
  const defenders = state.units.filter((u) => u.hex === hex && u.owner !== first.owner);
  if (defenders.length === 0 || defenders.some((u) => u.type !== 'artillery')) return;
  const hexes = attackers.map((a) => a.hex);
  const lost = defenders.filter((u) => !retreatOrCapitulate(state, u, hexes, ARTY_FLEE_LOSS));
  if (lost.length === 0) return;
  const rest = state.units.filter((u) => !lost.includes(u));
  state.units.splice(0, state.units.length, ...rest);
}

/**
 * Все бои тика: одинокая артиллерия бежит, потери и org одновременно для всех боёв, затем
 * исходы и захваты. Флаг боя отрядов сбрасывает artillerySystem.
 */
export function combatSystem(state: MatchState): void {
  for (const c of state.cities) c.inBattle = false;
  const targets = [
    ...new Set(state.units.filter((u) => u.order === 'attack').map((u) => u.target)),
  ];
  targets.sort((a, b) => a - b);
  for (const hex of targets) fleeLoneArtillery(state, hex);
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
