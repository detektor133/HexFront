import { describe, expect, it } from 'vitest';

import { FP, type Fp } from '../../src/math/int.ts';
import { at, city, own, road, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  f: own('A', 'forest'),
  m: own('A', 'mountains'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

/** Снабжённость отряда в процентах после пересчёта (все игроки успевают за 10 тиков). */
function supplyAfterRecalc(s: ReturnType<typeof scenario>, unitId: number): number {
  s.runTicks(10);
  return ((s.unitById(unitId)?.supplyLevel ?? -1) * 100) / FP;
}

describe('снабжённость отрядов', () => {
  it('отряд на дороге основной сети — 100 %', () => {
    const s = scenario(
      `
      A1 r  r  r
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(3, 0));
    expect(supplyAfterRecalc(s, id)).toBe(100);
  });

  it('4 гекса от дороги по равнине — 52 % (1 − 4 × 0,12)', () => {
    const s = scenario(
      `
      A1 r  a  a  a  a
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(5, 0));
    expect(supplyAfterRecalc(s, id)).toBe(52);
  });

  it('лес — 15 % за гекс, горы — 25 %', () => {
    const s = scenario(
      `
      A1 f  m
    `,
      { legend },
    );
    const forest = s.unit('A', 'infantry', 100, at(1, 0));
    const mountain = s.unit('A', 'infantry', 100, at(2, 0));
    s.runTicks(10);
    expect(s.unitById(forest)?.supplyLevel).toBe(850);
    expect(s.unitById(mountain)?.supplyLevel).toBe(600);
  });

  it('в радиусе 3 от склада потери вне дорог вдвое меньше', () => {
    const s = scenario(
      `
      A1 r  a  a  a  a
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(5, 0));
    s.setBuilding(at(1, 0), 'depot');
    // Гексы 2–4 в радиусе склада: 3 × 0,06; гекс 5 за радиусом: 0,12 → 30 % потерь.
    expect(supplyAfterRecalc(s, id)).toBe(70);
  });

  it('на нейтральном гексе — путь через последний свой гекс плюс потери этого гекса', () => {
    const s = scenario(
      `
      A1 a  .
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(2, 0));
    // Свой гекс (1,0) −12 %, нейтральный (2,0) −12 %.
    expect(supplyAfterRecalc(s, id)).toBe(76);
  });

  it('спрос больше производства: R = P / D (столица 500, пехота 1000 → 50 %)', () => {
    const s = scenario(
      `
      A1 a
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 1000, at(0, 0));
    expect(supplyAfterRecalc(s, id)).toBe(50);
  });

  it('бронетехника потребляет 2,5 на солдата', () => {
    const s = scenario(
      `
      A1 a
    `,
      { legend },
    );
    // 500 / (400 × 2,5) = 50 %.
    const id = s.unit('A', 'armor', 400, at(0, 0));
    expect(supplyAfterRecalc(s, id)).toBe(50);
  });

  it('изолированная сеть даёт снабжение ×0,5', () => {
    const s = scenario(
      `
      A1 a  a  a  a  a  A2
    `,
      { legend },
    );
    // Город ур. 1 изолирован: 250 × 0,5 = 125 на 250 пехоты → 50 %; от столицы — 1 − 6 × 0,12 = 28 %.
    const id = s.unit('A', 'infantry', 250, at(6, 0));
    expect(supplyAfterRecalc(s, id)).toBe(50);
  });

  it('отряд приписывается к сети, дающей больше снабжения', () => {
    const s = scenario(
      `
      A1 a  a  a  a  a  A2
    `,
      { legend },
    );
    // Рядом с изолированным A2 (−12 %) выгоднее, чем в 5 гексах от столицы (−60 %).
    const id = s.unit('A', 'infantry', 50, at(5, 0));
    expect(supplyAfterRecalc(s, id)).toBe(88);
  });

  it('банкротство — снабжённость ×0,5', () => {
    const s = scenario(
      `
      A1 r
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(1, 0));
    s.player('A').gold = 0 as Fp;
    s.unit('A', 'armor', 1000, at(0, 0));
    s.runTicks(1);
    expect(s.player('A').bankrupt).toBe(true);
    // Спрос 100 + 2500 при производстве 500, затем ×0,5 за банкротство.
    expect(supplyAfterRecalc(s, id)).toBeCloseTo((500 / 2600) * 50, 0);
  });

  it('пересчёт размазан: игрок 1 пересчитывается в тиках с tick % 10 == 1', () => {
    const s = scenario(
      `
      A1 a  .  b  b  b  b  B1
    `,
      { legend },
    );
    const id = s.unit('B', 'infantry', 100, at(3, 0));
    s.runTicks(1);
    expect(s.unitById(id)?.supplyLevel).toBe(FP);
    s.runTicks(1);
    // 1 − 4 × 0,12 = 52 %.
    expect(s.unitById(id)?.supplyLevel).toBe(520);
  });
});

describe('котёл и истощение', () => {
  const POCKET = `
    b  b  b  b  b
    b  B1 b  a  b
    b  b  b  b  b
    A1 r  r  r  r
  `;

  it('окружённый отряд: 0 %, котёл', () => {
    const s = scenario(POCKET, { legend });
    const id = s.unit('A', 'infantry', 1000, at(3, 1));
    s.runTicks(10);
    expect(s.unitById(id)?.supplyLevel).toBe(0);
    expect(s.unitById(id)?.encircled).toBe(true);
  });

  it('окружён → через 80 с (20 с льготы + 60 с истощения) ≤ 35 % солдат', () => {
    const s = scenario(POCKET, { legend });
    const id = s.unit('A', 'infantry', 1000, at(3, 1));
    s.runSeconds(20);
    // Льгота: первые 20 с без потерь.
    expect(s.unitById(id)?.soldiers).toBe(1000 * FP);
    s.runSeconds(60);
    const left = s.unitById(id)?.soldiers ?? 0;
    expect(left).toBeLessThanOrEqual(350 * FP);
    // 2 %/с на протяжении минуты: ≈ 30 %, а не полное уничтожение.
    expect(left).toBeGreaterThan(250 * FP);
  });

  it('снабжение 40 %: истощение 2 % × (1 − 0,4 / 0,5) = 0,4 %/с после льготы', () => {
    const s = scenario(
      `
      A1 a
    `,
      { legend },
    );
    // Столица 500 при спросе 1250 → 40 %.
    const id = s.unit('A', 'infantry', 1250, at(0, 0));
    // 200 тиков льготы — без потерь.
    s.runTicks(200);
    expect(s.unitById(id)?.soldiers).toBe(1250 * FP);
    // Следующая секунда при s = 40 %: 0,4 %/с × 1250 ≈ 5 солдат (сложный процент — чуть меньше).
    s.runTicks(10);
    const lost = 1250 * FP - (s.unitById(id)?.soldiers ?? 0);
    expect(lost / FP).toBeGreaterThan(4.9);
    expect(lost / FP).toBeLessThanOrEqual(5);
  });

  it('снабжение 50 % и выше — истощения нет', () => {
    const s = scenario(
      `
      A1 a
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 1000, at(0, 0));
    s.runSeconds(40);
    expect(s.unitById(id)?.soldiers).toBe(1000 * FP);
  });
});
