import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cloneState } from './clone.ts';
import { invariantViolations } from './invariants.ts';
import tiny from '../../../mapgen/maps/tiny.json' with { type: 'json' };
import type { UnitType } from '../../src/balance.ts';
import { validate } from '../../src/commands/apply.ts';
import type { Command, PlayerCommand } from '../../src/commands/types.ts';
import { loadMap } from '../../src/map/load.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import { createMatch } from '../../src/state/create-match.ts';
import { hashState } from '../../src/state/hash.ts';
import type { MatchState } from '../../src/state/types.ts';
import { step } from '../../src/step.ts';

const loaded = loadMap(tiny);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;

/** Длина одного случайного матча: 40 с — отряды успевают сойтись на карте tiny. */
const TICKS = 400;
const TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];
const ORDERS = ['idle', 'hold', 'expand'] as const;

/** Сырая команда: вид и числа, из которых по состоянию собирается настоящая команда. */
interface Raw {
  readonly at: number;
  readonly player: number;
  readonly kind: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

const rawArb = fc.record({
  at: fc.integer({ min: 0, max: TICKS - 1 }),
  player: fc.integer({ min: 0, max: 1 }),
  kind: fc.integer({ min: 0, max: 16 }),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.nat(1000),
});

function pickOf<T>(list: readonly T[], i: number): T | undefined {
  return list.length === 0 ? undefined : list[i % list.length];
}

// Команда по состоянию: индексы выбирают свои и чужие отряды, города, гексы.
function build(state: MatchState, r: Raw): Command | null {
  const own = state.units.filter((u) => u.owner === r.player);
  const enemy = state.units.filter((u) => u.owner !== r.player);
  const unit = pickOf(own, r.a);
  const size = state.hexes.owner.length;
  switch (r.kind) {
    case 0:
      return unit ? { t: 'move', unitIds: [unit.id], to: r.b % size } : null;
    // Атака втрое чаще остальных команд: без неё бои в 40-секундном матче редки.
    case 1:
    case 12:
    case 13: {
      const target = pickOf(enemy, r.b)?.hex ?? pickOf(state.cities, r.b)?.hex;
      return unit && target !== undefined ? { t: 'attack', unitIds: [unit.id], target } : null;
    }
    case 2: {
      const city = pickOf(
        state.cities.filter((c) => c.owner === r.player),
        r.a,
      );
      const soldiers = (50 * (1 + (r.c % 6)) * FP) as Fp;
      return city
        ? { t: 'recruit', cityId: city.id, type: TYPES[r.b % 3] ?? 'infantry', soldiers }
        : null;
    }
    case 3:
      return unit ? { t: 'setOrder', unitIds: [unit.id], order: ORDERS[r.b % 3] ?? 'idle' } : null;
    case 4:
      return unit
        ? { t: 'split', unitId: unit.id, soldiers: ((1 + (r.b % 200)) * FP) as Fp }
        : null;
    case 5: {
      const other = pickOf(own, r.b);
      return unit && other ? { t: 'merge', unitIds: [unit.id, other.id] } : null;
    }
    case 6:
      return { t: 'setTax', rate: (50 * (r.b % 9)) as Fp };
    case 7:
      return { t: 'createArmy', name: '' };
    case 8: {
      const army = pickOf(
        state.armies.filter((x) => x.owner === r.player),
        r.b,
      );
      return unit ? { t: 'assignUnits', unitIds: [unit.id], armyId: army?.id ?? null } : null;
    }
    case 9: {
      const target = pickOf(enemy, r.b);
      return unit ? { t: 'bombard', unitId: unit.id, targetUnitId: target?.id ?? null } : null;
    }
    case 10: {
      const army = pickOf(
        state.armies.filter((x) => x.owner === r.player),
        r.a,
      );
      return army ? { t: 'armyOrder', armyId: army.id, order: ORDERS[r.b % 3] ?? 'idle' } : null;
    }
    case 14: {
      const army = pickOf(
        state.armies.filter((x) => x.owner === r.player),
        r.a,
      );
      return army
        ? { t: 'assignFront', armyId: army.id, enemyId: 1 - r.player, section: null }
        : null;
    }
    case 15: {
      const army = pickOf(
        state.armies.filter((x) => x.owner === r.player),
        r.a,
      );
      const mineHexes = state.hexes.owner.reduce<number[]>(
        (acc, o, id) => (o === r.player ? [...acc, id] : acc),
        [],
      );
      const a = pickOf(mineHexes, r.b);
      const b = pickOf(mineHexes, r.c);
      return army && a !== undefined && b !== undefined
        ? { t: 'setDefenseLine', armyId: army.id, points: [a, b] }
        : null;
    }
    case 16: {
      const plan = pickOf(
        state.plans.filter((p) =>
          state.armies.some((x) => x.id === p.armyId && x.owner === r.player),
        ),
        r.a,
      );
      return plan ? { t: 'setOffensiveLine', armyId: plan.armyId, points: [r.b] } : null;
    }
    default:
      // Заведомо сомнительная команда: случайные id и гексы — проверка отказов.
      return { t: 'move', unitIds: [r.a], to: r.b };
  }
}

/** Сколько прогонов дошли до боя — покрытие боевых систем случайными матчами. */
let fought = 0;

function play(seed: number, raws: readonly Raw[]): MatchState {
  let battle = false;
  const state = createMatch(MAP, [{ name: 'A' }, { name: 'B' }], seed);
  const byTick = new Map<number, Raw[]>();
  for (const r of raws) byTick.set(r.at, [...(byTick.get(r.at) ?? []), r]);
  for (let t = 0; t < TICKS; t += 1) {
    const cmds: PlayerCommand[] = [];
    for (const r of byTick.get(t) ?? []) {
      const cmd = build(state, r);
      if (cmd) cmds.push({ playerId: r.player, cmd });
    }
    step(state, cmds);
    battle ||= state.units.some((u) => u.inBattle);
    const bad = invariantViolations(state);
    if (bad.length > 0) throw new Error(`тик ${t}: ${bad.slice(0, 5).join('; ')}`);
  }
  if (battle) fought += 1;
  return state;
}

describe('инварианты на случайных матчах с отрядами (testing.md)', () => {
  it('инварианты 1–6 и армии держатся после каждого тика; 500 прогонов', () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.array(rawArb, { maxLength: 60 }), (seed, raws) => {
        play(seed, raws);
      }),
      { numRuns: 500, seed: 3 },
    );
    // Покрытие: заметная доля прогонов доходит до боя или обстрела (сейчас 105 из 500).
    expect(fought).toBeGreaterThanOrEqual(75);
  }, 600_000);

  it('8: шаг повторяем — одинаковые команды на копиях дают одинаковый хэш', () => {
    fc.assert(
      fc.property(
        fc.nat(1_000_000),
        fc.array(rawArb, { maxLength: 30 }),
        rawArb,
        (seed, raws, last) => {
          const state = play(seed, raws);
          const a = cloneState(state);
          const b = cloneState(state);
          const cmd = build(a, last);
          const cmds: PlayerCommand[] = cmd ? [{ playerId: last.player, cmd }] : [];
          step(a, cmds);
          step(b, cmds);
          expect(hashState(a)).toBe(hashState(b));
        },
      ),
      { numRuns: 30, seed: 5 },
    );
  }, 120_000);

  it('9: отклонённая команда не меняет хэш', () => {
    fc.assert(
      fc.property(
        fc.nat(1_000_000),
        fc.array(rawArb, { maxLength: 30 }),
        rawArb,
        (seed, raws, last) => {
          const state = play(seed, raws);
          const cmd = build(state, last);
          fc.pre(cmd !== null && !validate(state, last.player, cmd).ok);
          const a = cloneState(state);
          const b = cloneState(state);
          step(a, cmd ? [{ playerId: last.player, cmd }] : []);
          step(b, []);
          expect(hashState(a)).toBe(hashState(b));
        },
      ),
      { numRuns: 30, seed: 7 },
    );
  }, 120_000);
});
