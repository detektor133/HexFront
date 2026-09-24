import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TICKS_PER_S } from '../../src/balance.ts';
import { hexFromId, distance } from '../../src/math/hex.ts';
import type { Fp } from '../../src/math/int.ts';
import { at, city, own, scenario, setTax, type At } from '../scenario/dsl.ts';

// Равнина: лимит гекса 100 чел.; город уровня L — 300 × L.
const people = (fpValue: number): number => fpValue / 1000;

describe('рост населения', () => {
  const RINGS = `
    .  .  .  .  .  .  .
    .  .  a  a  a  .  .
    .  a  a  A1 a  a  a
    .  .  a  a  a  .  .
    .  .  .  .  .  .  .
  `;
  const legend = { A1: city('A', 1, { capital: true }), a: own('A') };

  function growthPerSecond(
    where: At,
    startPeople: number,
    setup?: (s: ReturnType<typeof scenario>) => void,
  ): number {
    const s = scenario(RINGS, { legend });
    s.setPop(where, startPeople);
    setup?.(s);
    const before = s.pop(where);
    s.runTicks(1);
    return people((s.pop(where) - before) * TICKS_PER_S);
  }

  it('городской гекс растёт на 3,0 чел./с × (1 − pop/cap)', () => {
    expect(growthPerSecond(at(3, 2), 0)).toBeCloseTo(3.0, 2);
    expect(growthPerSecond(at(3, 2), 150)).toBeCloseTo(1.5, 2);
  });

  it('кольцо 1 растёт на 1,5 чел./с, кольцо 2 — на 0,5', () => {
    expect(growthPerSecond(at(4, 2), 0)).toBeCloseTo(1.5, 2);
    expect(growthPerSecond(at(5, 2), 0)).toBeCloseTo(0.5, 2);
  });

  it('свой гекс вне радиуса 2 не растёт, но и не убывает', () => {
    expect(growthPerSecond(at(6, 2), 10)).toBe(0);
  });

  it('нейтральный гекс в радиусе города не растёт', () => {
    expect(growthPerSecond(at(1, 1), 10)).toBe(0);
  });

  it('уровень города увеличивает рост: +25 % за уровень', () => {
    const s = scenario(RINGS, { legend: { ...legend, A1: city('A', 3, { capital: true }) } });
    s.setPop(at(4, 2), 0);
    s.runTicks(1);
    expect(people(s.pop(at(4, 2)) * TICKS_PER_S)).toBeCloseTo(1.5 * 1.5, 2);
  });

  it('гекс в кольце 1 двух городов берёт максимум, а не сумму', () => {
    const TWO = `
      .  .  .  .  .
      .  A1 a  A3 .
      .  .  .  .  .
    `;
    const s = scenario(TWO, {
      legend: { A1: city('A', 1, { capital: true }), A3: city('A', 3), a: own('A') },
    });
    s.setPop(at(2, 1), 0);
    s.runTicks(1);
    expect(people(s.pop(at(2, 1)) * TICKS_PER_S)).toBeCloseTo(1.5 * 1.5, 2);
  });

  it.each([
    [0, 1.4],
    [20, 1.0],
    [40, 0.5],
  ])('налог %i %% даёт множитель роста %f', (tax, mult) => {
    const s = scenario(RINGS, { legend });
    s.cmd('A', setTax(tax));
    s.runSeconds(20);
    s.setPop(at(4, 2), 0);
    s.runTicks(1);
    expect(people(s.pop(at(4, 2)) * TICKS_PER_S)).toBeCloseTo(1.5 * mult, 2);
  });

  it('благоустройство поднимает лимит ×1,5 и рост ×1,3 за уровень', () => {
    const s = scenario(RINGS, { legend });
    const id = 4 + 2 * s.state.map.width;
    s.state.hexes.improvement[id] = 1;
    s.setPop(at(4, 2), 100);
    s.runTicks(1);
    // pop/cap = 100/150: рост = 1,5 × 1,3 × (1 − 2/3).
    expect(people((s.pop(at(4, 2)) - 100_000) * TICKS_PER_S)).toBeCloseTo((1.5 * 1.3) / 3, 2);
  });

  it('рост замедляется к лимиту и не превышает его', () => {
    const s = scenario(RINGS, { legend });
    s.setPop(at(4, 2), 0);
    s.runSeconds(10);
    const early = s.pop(at(4, 2));
    s.runSeconds(600);
    const late = s.pop(at(4, 2));
    expect(late).toBeLessThanOrEqual(100_000);
    expect(late).toBeGreaterThan(95_000);
    expect(late - early).toBeLessThan(early * 60);
  });

  it('население сверх лимита убывает на 1 %/с до лимита', () => {
    const s = scenario(RINGS, { legend });
    s.setPop(at(6, 2), 150);
    s.runSeconds(1);
    expect(people(s.pop(at(6, 2)))).toBeCloseTo(150 * 0.99, 0);
    s.runSeconds(300);
    expect(s.pop(at(6, 2))).toBe(100_000);
  });
});

describe('инвариант: нет создания населения из ничего', () => {
  const GRID = `
    a  a  a  a  a  a  a  a
    a  A1 a  a  a  b  b  b
    a  a  a  a  a  B1 b  b
    a  a  .  .  .  b  b  b
  `;
  // Верхняя граница роста за тик: город L5, благоустройство 3, налог 0.
  const MAX_PER_TICK = (3.0 * 2.0 * 1.9 * 1.4 * 1000) / TICKS_PER_S;

  it('за тик гекс прибавляет не больше максимума формулы, вне радиуса городов — ничего', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 32, maxLength: 32 }),
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(0, 20, 40),
        (pops, level, tax) => {
          const s = scenario(GRID, {
            legend: {
              A1: city('A', level, { capital: true }),
              B1: city('B', 1, { capital: true }),
              a: own('A'),
              b: own('B'),
            },
          });
          pops.forEach((p, id) => (s.state.hexes.pop[id] = p * 1000));
          s.state.players.forEach((p) => {
            p.taxEffective = (tax * 10) as Fp;
            p.taxTarget = (tax * 10) as Fp;
          });
          const before = Int32Array.from(s.state.hexes.pop);
          s.runTicks(1);
          const cities = s.state.cities;
          s.state.hexes.pop.forEach((after, id) => {
            const delta = after - (before[id] ?? 0);
            expect(after).toBeGreaterThanOrEqual(0);
            expect(delta).toBeLessThanOrEqual(MAX_PER_TICK);
            const h = hexFromId(id, s.state.map.width);
            const owner = s.state.hexes.owner[id];
            const nearOwnCity = cities.some(
              (c) => c.owner === owner && distance(hexFromId(c.hex, s.state.map.width), h) <= 2,
            );
            if (!nearOwnCity) expect(delta).toBeLessThanOrEqual(0);
          });
        },
      ),
      { numRuns: 60 },
    );
  });
});
