import { describe, expect, it } from 'vitest';

import { ASSAULT_GAP } from '../../src/balance.ts';
import { applyCommands } from '../../src/commands/apply.ts';
import { distance, hexFromId } from '../../src/math/hex.ts';
import { allocate } from '../../src/state/allocate.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const ROW = 'a  a  a  a  b  b  b  b  b  b  b  b  b  b';
const MAP = [
  'A1 a  a  a  b  b  b  b  b  b  b  b  b  B1',
  ...Array.from({ length: 6 }, () => ROW),
].join('\n');
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function war() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (const row of [0, 2, 4, 6]) s.unit('A', 'infantry', 200, at(2, row));
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
  return s;
}

describe('целостное наступление', () => {
  it('столицу атакуют, только когда своя земля подошла к ней вплотную: червя через страну нет', () => {
    const s = war();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 800 } },
    ]);
    const capital = 13;
    const w = s.state.map.width;
    const gap = (): number => {
      let best = 99;
      s.state.hexes.owner.forEach((o, h) => {
        if (o === 0) {
          best = Math.min(best, distance(hexFromId(h, w), hexFromId(capital, w)));
        }
      });
      return best;
    };
    let ordered = false;
    for (let t = 0; t < 900; t += 1) {
      s.runTicks(1);
      const units = s.state.units.filter((u) => u.owner === 0);
      const toCapital = units.some((u) => u.path.at(-1) === capital || u.target === capital);
      if (toCapital) {
        ordered = true;
        // К моменту приказа своя земля уже в ASSAULT_GAP + 1 гексах (земля берётся и во время хода).
        expect(gap()).toBeLessThanOrEqual(ASSAULT_GAP + 2);
      }
    }
    expect(ordered).toBe(true);
  });

  it('пересмотр линии не меняет отряды местами: каждый остаётся на своём месте, пока оно нужно', () => {
    const s = war();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 800 } }]);
    s.runSeconds(20);
    const army = s.state.armies.find((a) => a.owner === 0 && a.dir !== undefined);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    if (plan?.kind !== 'front') throw new Error('нет фронта');
    const units = s.state.units.filter((u) => u.armyId === army?.id && u.type !== 'artillery');
    const before = new Map(units.map((u) => [u.id, u.slot]));
    const placed = allocate(s.state, plan, 0).slots;
    for (const u of units) {
      const was = before.get(u.id) ?? -1;
      if (was < 0) continue;
      // Место отряда не отнято другому: новое место — либо прежнее, либо прежнего нет в расчёте.
      const now = placed.get(u.id);
      const stillWanted = [...placed.values()].includes(was);
      if (stillWanted) expect(now).toBe(was);
    }
  });
});
