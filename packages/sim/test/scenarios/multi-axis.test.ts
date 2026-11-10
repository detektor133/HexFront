import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { pickAxes } from '../../src/commands/axis.ts';
import { borderPieces } from '../../src/commands/launch.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { lineRuns } from '../../src/systems/offensive.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const row = (left: string): string => `${left}  a  a  a  b  b  b  b  b  b  b`;
const TALL = [
  'A1  a  a  a  b  b  b  b  b  b  b',
  ...Array.from({ length: 38 }, () => row('a ')),
  'a   a  a  a  b  b  b  b  b  b  B1',
].join('\n');

function war() {
  const s = scenario(TALL, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (let r = 0; r < 40; r += 2) s.unit('A', 'infantry', 300, at(3, r));
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
  return s;
}

describe('несколько линий наступления', () => {
  it('большой заказ на широком фронте — несколько осей, у малого одна', () => {
    const wide = war();
    applyCommands(wide.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 1200 } },
    ]);
    const army = wide.state.armies.find((a) => a.owner === 0);
    const plan = wide.state.plans.find((p) => p.armyId === army?.id);
    if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет наступления');
    expect(lineRuns(wide.state, plan.offensive.edges).length).toBeGreaterThanOrEqual(2);

    const narrow = war();
    applyCommands(narrow.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 250 } },
    ]);
    const army2 = narrow.state.armies.find((a) => a.owner === 0);
    const plan2 = narrow.state.plans.find((p) => p.armyId === army2?.id);
    if (plan2?.kind !== 'front' || !plan2.offensive) throw new Error('нет наступления');
    expect(lineRuns(narrow.state, plan2.offensive.edges).length).toBe(1);
  });

  it('ИИ обновляет линии: за минуту наступления граница с целью сдвигается', () => {
    const s = war();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 1200 } },
    ]);
    const before = s.state.hexes.owner.filter((o) => o === 0).length;
    s.runSeconds(90);
    expect(s.state.hexes.owner.filter((o) => o === 0).length).toBeGreaterThan(before);
  });
});

describe('слияние мелочи', () => {
  it('мелкие отряды резерва стягиваются и сливаются', () => {
    const s = scenario(
      `
      A1 a  a  a  a  a
      a  a  a  a  a  a
    `,
      { legend },
    );
    s.unit('A', 'infantry', 5, at(1, 0));
    s.unit('A', 'infantry', 7, at(2, 0));
    s.unit('A', 'infantry', 100, at(3, 1));
    // Резерв (без армии) тоже стягивается: отряды сливаются в один.
    s.runSeconds(30);
    expect(s.unitsOf('A').length).toBe(1);
    expect(s.unitsOf('A')[0]?.soldiers).toBe(112_000);
  });
});

describe('штурм городов и резерв направлением', () => {
  const MAP = `
    A1 a  a  a  b  b  b  b  b  b  b  b
    a  a  a  a  b  b  b  b  b  b  b  b
    a  a  a  a  b  b  b  b  b  b  B1 b
    a  a  a  a  b  b  b  b  b  b  b  b
    a  a  a  a  b  b  b  b  b  b  b  b
  `;
  function assault() {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (let r = 0; r < 5; r += 1) s.unit('A', 'infantry', 300, at(3, r));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    return s;
  }

  it('группа отрядов идёт на город врага и берёт его', () => {
    const s = assault();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 1500 } },
    ]);
    s.runSeconds(240);
    // Город врага взят: у игрока два города (свой и вражеский).
    expect(s.state.cities.filter((c) => c.owner === 0).length).toBe(2);
  });

  it('свободный резерв вливается в наступающую армию, а не стоит в тылу', () => {
    const s = assault();
    const reserve = s.unit('A', 'infantry', 300, at(0, 4));
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 300 } },
    ]);
    s.runSeconds(10);
    const army = s.state.armies.find((a) => a.owner === 0 && a.dir?.target === 1);
    expect(s.unitById(reserve)?.armyId).toBe(army?.id);
  });
});

describe('фронт направления — сама граница', () => {
  it('фронт всегда ровно на границе с целью, а между тиками меняется только локально', () => {
    const s = war();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 1200 } },
    ]);
    const army = s.state.armies.find((a) => a.owner === 0 && a.dir?.target === 1);
    let previous: ReadonlySet<number> | null = null;
    let exact = 0;
    let biggestJump = 0;
    // Конец наступления перестраивает фронт целиком (дуга → вся граница) за один-два тика: это не «захват».
    let rebuilt = 0;
    for (let t = 0; t < 1200; t += 1) {
      s.runTicks(1);
      if (s.state.events.some((e) => e.t === 'offensiveDone')) rebuilt = 2;
      const plan = s.state.plans.find((p) => p.armyId === army?.id);
      if (plan?.kind !== 'front') break; // цель выбыла — направление снято
      const edges = new Set(plan.edges);
      if (plan.rev === s.state.supplyRevision) {
        const border = new Set(borderPieces(s.state, 0, 1).flat());
        // Цель выбыла или границы нет — фронту не за что держаться, проверять нечего.
        if (border.size === 0) break;
        expect([...edges].every((e) => border.has(e))).toBe(true);
        expect([...border].every((e) => edges.has(e))).toBe(true);
        exact += 1;
      }
      if (previous && rebuilt === 0) {
        const changed = [...edges].filter((e) => !previous?.has(e)).length;
        biggestJump = Math.max(biggestJump, changed);
      }
      previous = edges;
      if (rebuilt > 0) rebuilt -= 1;
    }
    expect(exact).toBeGreaterThan(30);
    // Один захват двигает несколько граней, но не весь фронт (в нём больше 80 граней).
    expect(biggestJump).toBeLessThan(60);
  }, 30_000);
});

describe('оси удара: граничные случаи', () => {
  it('новых осей не нужно (want = 0): пустой удар, а не деление на ноль', () => {
    const s = war();
    const pieces = borderPieces(s.state, 0, 1);
    const enemy = (who: number): boolean => who === 1;
    expect(() => pickAxes(s.state, 0, enemy, pieces, 1200, [], 0)).not.toThrow();
    expect(pickAxes(s.state, 0, enemy, pieces, 1200, [], 0).axes).toBe(0);
    expect(pickAxes(s.state, 0, enemy, pieces, 1200, [], -2).axes).toBe(0);
  });
});

describe('занятие ничьей земли: штурм ничьего города', () => {
  const OPEN = `
    A1 a  a  .  .  .  .  .
    a  a  a  .  .  n5 .  .
    a  a  a  .  .  .  .  .
  `;
  const open = { ...legend, n5: city(null, 5) };

  function neutral(units: number, soldiers: number) {
    const s = scenario(OPEN, { legend: open });
    // Сильный гарнизон: 400 солдат при полной организованности.
    const target = s.state.cities.find((c) => c.owner === -1);
    if (target) {
      target.defenders = (400 * 1000) as typeof target.defenders;
      target.defenseOrg = 100_000 as typeof target.defenseOrg;
    }
    for (let i = 0; i < units; i += 1) s.unit('A', 'infantry', soldiers, at(2, i % 3));
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: -1, soldiers: units * soldiers } },
    ]);
    return s;
  }

  it('одному слабому отряду город не по силам: в бой он не лезет, а занимает землю', () => {
    const s = neutral(1, 30);
    s.runSeconds(90);
    expect(s.state.cities.filter((c) => c.owner === 0)).toHaveLength(1);
    expect(s.state.units.some((u) => u.order === 'attack')).toBe(false);
    expect(s.state.units).toHaveLength(1);
  });

  it('сильная группа берёт ничей город', () => {
    const s = neutral(8, 300);
    s.runSeconds(240);
    expect(s.state.cities.filter((c) => c.owner === 0).length).toBe(2);
  });

  it('далёкий город не тянет войска: земля растёт плотно, штурма нет, пока он не рядом', () => {
    const far = `
      A1 a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  n5
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
      a  a  a  .  .  .  .  .  .  .  .  .  .  .  .  .  . 
    `;
    const s = scenario(far, { legend: open });
    for (let i = 0; i < 4; i += 1) s.unit('A', 'infantry', 100, at(2, 2 * i));
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: -1, soldiers: 400 } },
    ]);
    s.runSeconds(12);
    expect(s.state.units.some((u) => u.order === 'attack')).toBe(false);
    const width = s.state.map.width;
    const columns = Array.from(
      { length: width },
      (_, c) => s.state.hexes.owner.filter((o, h) => o === 0 && h % width === c).length,
    );
    // Малая армия растит землю от своей границы, а не червём к далёкому городу.
    expect(columns.slice(-4).every((n) => n === 0)).toBe(true);
    expect(columns[3]).toBeGreaterThanOrEqual(6);
  });
});
