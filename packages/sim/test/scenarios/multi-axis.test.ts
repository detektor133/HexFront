import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { lineRuns } from '../../src/systems/offensive.ts';
import { assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

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
  it('мелкие отряды одной армии стягиваются и сливаются', () => {
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
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd(
      'A',
      assignUnits(
        s.unitsOf('A').map((u) => u.id),
        army,
      ),
    );
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
