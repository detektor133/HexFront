import { describe, expect, it } from 'vitest';

import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  own,
  scenario,
  setDefenseLine,
  setOffensiveLine,
  stopOffensive,
  type At,
} from '../scenario/dsl.ts';

// Фронт A — столбец 2, земля B — столбцы 3–7; линия наступления — столбец 5.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const LINE: readonly At[] = [at(5, 0), at(5, 4)];

type S = ReturnType<typeof scenario>;

function armyOf(s: S, units: readonly number[]): number {
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(units, army));
  s.runTicks(1);
  return army;
}

function frontArmy(s: S, n: number): { army: number; ids: number[] } {
  const ids = Array.from({ length: n }, () => s.unit('A', 'infantry', 300, at(0, 2)));
  const army = armyOf(s, ids);
  s.cmd('A', assignFront(army, 'B', null));
  s.runSeconds(20);
  return { army, ids };
}

const ownerOf = (s: S, c: number, r: number): string | null => s.owner(at(c, r));

describe('линия наступления (CR-002, как в HoI4)', () => {
  it('армия всем участком берёт зону до линии и не заходит за неё', () => {
    const s = scenario(FIELD, { legend });
    const { army } = frontArmy(s, 5);
    s.cmd('A', setOffensiveLine(army, LINE));
    s.runSeconds(80);
    for (const c of [3, 4, 5]) {
      for (let r = 0; r < 5; r += 1) expect(ownerOf(s, c, r)).toBe('A');
    }
    for (let r = 0; r < 5; r += 1) expect(ownerOf(s, 6, r)).toBe('B');
  });

  it('взятая зона завершает наступление, армия остаётся на новой линии фронта', () => {
    const s = scenario(FIELD, { legend });
    const { army } = frontArmy(s, 5);
    s.cmd('A', setOffensiveLine(army, LINE));
    s.runSeconds(80);
    const plan = s.state.plans.find((p) => p.armyId === army);
    expect(plan?.kind).toBe('front');
    expect(plan?.kind === 'front' && plan.offensive).toBeNull();
    expect(s.lastEvent('offensiveDone')).toBeDefined();
  });

  it('в гекс с прогнозом «Поражение» отряды не атакуют', () => {
    const s = scenario(FIELD, { legend });
    s.unit('B', 'infantry', 3000, at(3, 2));
    const { army } = frontArmy(s, 5);
    s.cmd('A', setOffensiveLine(army, LINE));
    s.runSeconds(30);
    expect(ownerOf(s, 3, 2)).toBe('B');
    expect(s.state.units.some((u) => u.owner === 0 && u.inBattle)).toBe(false);
  });

  it('отряды с org < 30 не наступают', () => {
    const s = scenario(FIELD, { legend });
    const { army, ids } = frontArmy(s, 5);
    for (const id of ids) s.setOrg(id, 20);
    s.cmd('A', setOffensiveLine(army, LINE));
    s.runTicks(25);
    for (let r = 0; r < 5; r += 1) expect(ownerOf(s, 3, r)).toBe('B');
  });

  it('«Стоп» прекращает наступление', () => {
    const s = scenario(FIELD, { legend });
    const { army } = frontArmy(s, 5);
    s.cmd('A', setOffensiveLine(army, LINE));
    s.cmd('A', stopOffensive(army));
    s.runSeconds(30);
    for (let r = 0; r < 5; r += 1) expect(ownerOf(s, 4, r)).toBe('B');
  });

  it('линия наступления только у армии с линией фронта — иначе noFront', () => {
    const s = scenario(FIELD, { legend });
    const idle = armyOf(s, [s.unit('A', 'infantry', 100, at(0, 0))]);
    const line = armyOf(s, [s.unit('A', 'infantry', 100, at(0, 1))]);
    s.cmd('A', setDefenseLine(line, [at(1, 0), at(1, 4)]));
    s.runTicks(1);
    s.cmd('A', setOffensiveLine(idle, LINE));
    s.cmd('A', setOffensiveLine(line, LINE));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['noFront', 'noFront']);
  });

  it('не больше 3 наступлений одновременно', () => {
    const s = scenario(FIELD, { legend });
    const armies = [0, 1, 2, 3].map((r) => {
      const a = armyOf(s, [s.unit('A', 'infantry', 100, at(0, r))]);
      s.cmd('A', assignFront(a, 'B', [at(2, r), at(2, r)]));
      return a;
    });
    s.runTicks(1);
    for (const a of armies) s.cmd('A', setOffensiveLine(a, LINE));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['tooManyOffensives']);
  });
});
