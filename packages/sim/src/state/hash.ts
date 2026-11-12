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
    int(s, c.captureTicks);
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
    int(s, p.autoCommand ? 1 : 0);
    int(s, p.chaosTicks);
    int(s, p.noCityTicks);
    int(s, p.eliminatedTick);
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
    int(s, a.sea ? 1 : 0);
    int(s, a.seaFrom);
    int(s, a.target);
    int(s, a.inBattle ? 1 : 0);
    int(s, a.focus);
    int(s, a.fireTarget);
    int(s, a.slot);
    // Только активный сбор: без него хэш матча прежний.
    if (a.gather >= 0) int(s, a.gather);
    // Запрет обратного хода влияет на решения автоматики, поэтому входит в хэш.
    if (a.came !== undefined) {
      int(s, a.came);
      int(s, a.cameTick ?? 0);
    }
  }
  int(s, state.armies.length);
  for (const a of state.armies) {
    int(s, a.id);
    int(s, a.owner);
    int(s, a.number);
    str(s, a.name);
    int(s, a.auto ? 1 : 0);
    // Поле появилось позже: без него хэш прежних матчей не меняется.
    if (a.wanted !== undefined) int(s, a.wanted);
    if (a.xp !== undefined && a.xp > 0) int(s, a.xp);
    if (a.mix !== undefined) {
      int(s, a.mix.armor);
      int(s, a.mix.artillery);
    }
    if (a.dir !== undefined) {
      int(s, a.dir.target);
      int(s, a.dir.mode === 'hold' ? 0 : a.dir.mode === 'attack' ? 1 : 2);
      if (a.dir.hex !== undefined) int(s, a.dir.hex);
    }
  }
  int(s, state.plans.length);
  for (const p of state.plans) {
    int(s, p.armyId);
    str(s, p.kind);
    if (p.kind === 'front') {
      array(s, p.edges);
      int(s, p.offensive ? 1 : 0);
      array(s, p.offensive?.edges ?? []);
      array(s, p.offensive?.hexes ?? []);
      int(s, p.offensive?.active ? 1 : 0);
      int(s, p.offensive?.progressTick ?? 0);
      array(s, p.offensive?.taken ?? []);
      array(s, p.lost ?? []);
      int(s, p.startWanted ? 1 : 0);
    } else array(s, p.hexes);
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
    if (r.armyId !== undefined) int(s, r.armyId);
  }
}

/**
 * Хэш всего изменяемого состояния и идентичности карты; события тика не входят.
 * @returns 8 шестнадцатеричных символов (FNV-1a, 32 бита)
 */
function hashDiplomacy(s: Hasher, state: MatchState): void {
  const d = state.diplomacy;
  if (!d) return;
  const codes = { peace: 0, war: 1, pact: 2, alliance: 3, defense: 4 } as const;
  for (const r of d.relation) int(s, codes[r]);
  for (const v of d.violations) int(s, v);
  // Отношения хэшируются только ненулевые (индекс и значение): нулевая матрица не меняет хэш.
  for (const matrix of [d.attitude, d.changedAt]) {
    matrix?.forEach((value, index) => {
      if (value === 0) return;
      int(s, index);
      int(s, value);
    });
  }
  for (const o of d.offers) {
    int(s, o.from);
    int(s, o.to);
    int(s, o.kind === 'pact' ? 0 : o.kind === 'alliance' ? 1 : o.kind === 'defense' ? 3 : 2);
    int(s, o.tick);
  }
  // Новые части дипломатии хэшируются, только когда есть записи: прежние матчи не меняют хэш.
  for (const c of d.calls ?? []) for (const v of [c.ally, c.victim, c.aggressor, c.tick]) int(s, v);
  for (const r of d.results ?? []) {
    const kind = r.kind === 'join' ? 0 : r.kind === 'peace' ? 1 : 2;
    for (const x of [r.id, kind, r.a, r.b, r.passed ? 1 : 0, r.tick]) int(s, x);
    for (const x of [...r.voters, ...r.yes, ...r.no]) int(s, x);
  }
  for (const w of d.aid ?? [])
    for (const v of [w.ally, w.victim, w.aggressor, w.ending ?? -1]) int(s, v);
  for (const v of d.votes ?? []) {
    for (const x of [v.id, v.kind === 'join' ? 0 : v.kind === 'peace' ? 1 : 2, v.a, v.b, v.tick])
      int(s, x);
    for (const x of [...v.voters, ...v.yes, ...v.no]) int(s, x);
    for (const side of v.sides ?? []) for (const x of [side.length, ...side]) int(s, x);
  }
}

export function hashState(state: MatchState): string {
  const s: Hasher = { h: FNV_OFFSET };
  int(s, state.tick);
  int(s, state.seed);
  int(s, state.fog ? 1 : 0);
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
  int(s, state.winner);
  int(s, state.holdPlayer);
  int(s, state.holdTicks);
  hashDiplomacy(s, state);
  return s.h.toString(16).padStart(8, '0');
}
