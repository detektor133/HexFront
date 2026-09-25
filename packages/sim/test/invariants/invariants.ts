// Обязательные инварианты из docs/testing.md (1–6) и инварианты армий CR-001.
// Возвращают список нарушений: пустой — всё в порядке.
import { MAX_UNITS_PER_HEX, ORG_MAX } from '../../src/balance.ts';
import { TERRAIN } from '../../src/map/types.ts';
import { FP } from '../../src/math/int.ts';
import type { MatchState } from '../../src/state/types.ts';

const isSafeInt = (v: number): boolean => Number.isSafeInteger(v);

function checkNumbers(state: MatchState, out: string[]): void {
  for (const u of state.units) {
    for (const [k, v] of [
      ['soldiers', u.soldiers],
      ['org', u.org],
      ['supplyLevel', u.supplyLevel],
      ['hex', u.hex],
      ['moveTicks', u.moveTicks],
      ['moveTotal', u.moveTotal],
      ['lowSupplyTicks', u.lowSupplyTicks],
    ] as const) {
      if (!isSafeInt(v)) out.push(`отряд ${u.id}: ${k} не целое (${v})`);
    }
    if (u.soldiers < 0) out.push(`отряд ${u.id}: солдат < 0`);
    if (u.org < 0 || u.org > ORG_MAX) out.push(`отряд ${u.id}: org вне 0..100 (${u.org})`);
    if (u.supplyLevel < 0 || u.supplyLevel > FP) out.push(`отряд ${u.id}: снабжение вне 0..1`);
  }
  for (const p of state.players) {
    if (!isSafeInt(p.gold) || p.gold < 0) out.push(`игрок ${p.id}: золото ${p.gold}`);
  }
  state.hexes.pop.forEach((v, hex) => {
    if (v < 0) out.push(`гекс ${hex}: население < 0`);
  });
  for (const c of state.cities) {
    if (!isSafeInt(c.defenders) || c.defenders < 0)
      out.push(`город ${c.id}: оборона ${c.defenders}`);
  }
}

function checkHexes(state: MatchState, out: string[]): void {
  const byHex = new Map<number, { owners: Set<number>; count: Map<number, number> }>();
  for (const u of state.units) {
    const e = byHex.get(u.hex) ?? { owners: new Set<number>(), count: new Map<number, number>() };
    e.owners.add(u.owner);
    e.count.set(u.owner, (e.count.get(u.owner) ?? 0) + 1);
    byHex.set(u.hex, e);
    if (state.map.terrain[u.hex] === TERRAIN.water) out.push(`отряд ${u.id}: на воде`);
    if (u.type === 'artillery' && state.hexes.owner[u.hex] !== u.owner) {
      out.push(`артиллерия ${u.id}: на чужом гексе ${u.hex}`);
    }
  }
  for (const [hex, e] of byHex) {
    if (e.owners.size > 1) out.push(`гекс ${hex}: отряды разных владельцев`);
    for (const [owner, n] of e.count) {
      if (n > MAX_UNITS_PER_HEX) out.push(`гекс ${hex}: у игрока ${owner} ${n} отрядов`);
    }
  }
}

function checkOwnership(state: MatchState, out: string[]): void {
  for (const c of state.cities) {
    if (state.hexes.owner[c.hex] !== c.owner) out.push(`город ${c.id}: владелец ≠ владелец гекса`);
  }
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const cities = state.cities.filter((c) => c.owner === p.id);
    const capital = cities.filter((c) => c.id === p.capitalCityId);
    if (cities.length > 0 && capital.length !== 1) out.push(`игрок ${p.id}: столица не одна`);
  }
  for (const u of state.units) {
    if (u.armyId === null) continue;
    const army = state.armies.find((a) => a.id === u.armyId);
    if (!army) out.push(`отряд ${u.id}: несуществующая армия ${u.armyId}`);
    else if (army.owner !== u.owner) out.push(`отряд ${u.id}: армия чужого игрока`);
  }
}

/**
 * Инварианты 1–6 из testing.md и армии CR-001 (отряд — не более чем в одной армии своего
 * владельца). Инварианты 7–9 проверяются отдельно (рост населения, повторяемость, отказы).
 * @returns описания нарушений
 */
export function invariantViolations(state: MatchState): string[] {
  const out: string[] = [];
  checkNumbers(state, out);
  checkHexes(state, out);
  checkOwnership(state, out);
  return out;
}
