import { describe, expect, it } from 'vitest';

import { at, attack, city, own, scenario } from './scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B2: city('B', 1),
  b: own('B'),
};

describe('07/T17at: события захвата города', () => {
  it('Приёмка 1: cityCaptured несёт прежнего и нового владельцев до/после захвата', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      A1 a  a  B2 b
      ~  ~  ~  ~  ~
      `,
      { legend },
    );
    const cityBefore = s.cityAt(at(3, 1));
    expect(cityBefore?.owner).toBe(1);

    const attacker = s.unit('A', 'infantry', 1000, at(2, 1));
    s.cmd('A', attack([attacker], at(3, 1)));
    for (let tick = 0; tick < 300 && s.owner(at(3, 1)) !== 'A'; tick += 1) {
      s.runTicks(1);
    }

    expect(s.owner(at(3, 1))).toBe('A');
    expect(s.lastEvent('cityCaptured')).toMatchObject({
      t: 'cityCaptured',
      previousOwnerId: 1,
      newOwnerId: 0,
    });
  });
});
