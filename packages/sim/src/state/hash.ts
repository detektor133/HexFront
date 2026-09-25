// Стабильный хэш состояния для golden-тестов и реплеев.
// Архитектура: docs/architecture/sim-core.md — «Детерминизм» (FNV-1a, фиксированный порядок полей).
import type { MatchState } from './types.ts';
import { intDiv } from '../math/int.ts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32 = 0x1_0000_0000;

interface Hasher {
  h: number;
}

function byte(s: Hasher, b: number): void {
  s.h = Math.imul(s.h ^ (b & 0xff), FNV_PRIME) >>> 0;
}

function u32(s: Hasher, v: number): void {
  byte(s, v);
  byte(s, v >>> 8);
  byte(s, v >>> 16);
  byte(s, v >>> 24);
}

// Целые до 2⁵³ разбиваются на два 32-битных слова, чтобы не терять старшие разряды.
function int(s: Hasher, v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`hashState: не целое число ${v}`);
  const lo = ((v % UINT32) + UINT32) % UINT32;
  u32(s, lo);
  u32(s, intDiv(v - lo, UINT32));
}

function str(s: Hasher, v: string): void {
  int(s, v.length);
  for (let i = 0; i < v.length; i += 1) int(s, v.charCodeAt(i));
}

function array(s: Hasher, a: ArrayLike<number>): void {
  int(s, a.length);
  for (let i = 0; i < a.length; i += 1) int(s, a[i] ?? 0);
}

function hashEntities(s: Hasher, state: MatchState): void {
  int(s, state.cities.length);
  for (const c of state.cities) {
    int(s, c.id);
    int(s, c.hex);
    int(s, c.owner);
    int(s, c.level);
    str(s, c.name);
    int(s, c.defenders);
    int(s, c.defenseOrg);
    int(s, c.inBattle ? 1 : 0);
  }
  int(s, state.players.length);
  for (const p of state.players) {
    int(s, p.id);
    int(s, p.gold);
    int(s, p.taxTarget);
    int(s, p.taxEffective);
    int(s, p.capitalCityId);
    str(s, p.status);
    int(s, p.citiesFounded);
    int(s, p.bankrupt ? 1 : 0);
    int(s, p.armiesCreated);
    int(s, p.autoReinforce ? 1 : 0);
  }
  int(s, state.units.length);
  for (const a of state.units) {
    int(s, a.id);
    int(s, a.owner);
    str(s, a.type);
    int(s, a.soldiers);
    int(s, a.org);
    int(s, a.hex);
    str(s, a.order);
    int(s, a.supplyLevel);
    array(s, a.path);
    int(s, a.moveTicks);
    int(s, a.moveTotal);
    int(s, a.armyId ?? -1);
    int(s, a.lowSupplyTicks);
    int(s, a.encircled ? 1 : 0);
    int(s, a.target);
    int(s, a.inBattle ? 1 : 0);
    int(s, a.focus);
    int(s, a.fireTarget);
  }
  int(s, state.armies.length);
  for (const a of state.armies) {
    int(s, a.id);
    int(s, a.owner);
    int(s, a.number);
    str(s, a.name);
  }
}

function hashConstructions(s: Hasher, state: MatchState): void {
  int(s, state.constructions.length);
  for (const c of state.constructions) {
    int(s, c.id);
    int(s, c.owner);
    int(s, c.hex);
    str(s, c.kind);
    int(s, c.progressTicks);
    int(s, c.totalTicks);
    array(s, c.path ?? []);
  }
  int(s, state.recruits.length);
  for (const r of state.recruits) {
    int(s, r.id);
    int(s, r.owner);
    int(s, r.cityId);
    str(s, r.type);
    int(s, r.soldiers);
    int(s, r.progressTicks);
    int(s, r.totalTicks);
  }
}

/**
 * Хэш всего изменяемого состояния и идентичности карты; события тика не входят.
 * @returns 8 шестнадцатеричных символов (FNV-1a, 32 бита)
 */
export function hashState(state: MatchState): string {
  const s: Hasher = { h: FNV_OFFSET };
  int(s, state.tick);
  int(s, state.seed);
  int(s, state.nextId);
  str(s, state.map.id);
  int(s, state.map.width);
  int(s, state.map.height);
  const { hexes } = state;
  array(s, hexes.owner);
  array(s, hexes.pop);
  array(s, hexes.improvement);
  array(s, hexes.building);
  array(s, hexes.road);
  array(s, hexes.network);
  hashEntities(s, state);
  hashConstructions(s, state);
  int(s, state.networks.length);
  for (const n of state.networks) {
    int(s, n.id);
    int(s, n.owner);
    int(s, n.isMain ? 1 : 0);
  }
  return s.h.toString(16).padStart(8, '0');
}
