import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { validateUnitCommand } from '../../src/commands/unit.ts';
import { hashState } from '../../src/state/hash.ts';
import { createDiplomacy, atWar, relationOf } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  b  b  B1
  a  a  a  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function peace() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  return s;
}

const run = (s: ReturnType<typeof peace>, playerId: number, cmd: never) => {
  applyCommands(s.state, [{ playerId, cmd }]);
};

describe('дипломатия', () => {
  it('по умолчанию мир: нападать и входить в чужие гексы нельзя, пока не объявлена война', () => {
    const s = peace();
    const mine = s.unit('A', 'infantry', 300, at(2, 0));
    s.unit('B', 'infantry', 100, at(3, 0));
    const unit = s.state.units.find((u) => u.id === mine);
    if (!unit) throw new Error('нет отряда');
    expect(atWar(s.state, 0, 1)).toBe(false);
    const target = at(3, 0).col + at(3, 0).row * s.state.map.width;
    expect(validateUnitCommand(s.state, 0, { t: 'attack', unitIds: [mine], target })).toEqual({
      ok: false,
      reason: 'notEnemy',
    });
    run(s, 0, { t: 'declareWar', target: 1 } as never);
    expect(atWar(s.state, 0, 1)).toBe(true);
    expect(validateUnitCommand(s.state, 0, { t: 'attack', unitIds: [mine], target }).ok).toBe(true);
  });

  it('пакт и союз: предложение, принятие, разрыв и война против партнёра считаются нарушениями', () => {
    const s = peace();
    run(s, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' } as never);
    run(s, 1, { t: 'answerTreaty', from: 0, accept: true } as never);
    expect(relationOf(s.state, 0, 1)).toBe('pact');
    run(s, 0, { t: 'proposeTreaty', target: 1, kind: 'alliance' } as never);
    run(s, 1, { t: 'answerTreaty', from: 0, accept: true } as never);
    expect(relationOf(s.state, 1, 0)).toBe('alliance');
    run(s, 1, { t: 'declareWar', target: 0 } as never);
    expect(atWar(s.state, 0, 1)).toBe(true);
    expect(s.state.diplomacy?.violations).toEqual([0, 1]);
    run(s, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' } as never);
    run(s, 1, { t: 'answerTreaty', from: 0, accept: true } as never);
    run(s, 0, { t: 'breakTreaty', target: 1 } as never);
    expect(relationOf(s.state, 0, 1)).toBe('peace');
    expect(s.state.diplomacy?.violations).toEqual([1, 1]);
  });

  it('отклонённое и просроченное предложение договор не создают; хэш учитывает отношения', () => {
    const s = peace();
    const before = hashState(s.state);
    run(s, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' } as never);
    run(s, 1, { t: 'answerTreaty', from: 0, accept: false } as never);
    expect(relationOf(s.state, 0, 1)).toBe('peace');
    run(s, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' } as never);
    s.runTicks(400);
    const events = s.state.events.length;
    run(s, 1, { t: 'answerTreaty', from: 0, accept: true } as never);
    expect(relationOf(s.state, 0, 1)).toBe('peace');
    expect(s.state.events.length).toBeGreaterThanOrEqual(events);
    run(s, 0, { t: 'declareWar', target: 1 } as never);
    expect(hashState(s.state)).not.toBe(before);
  });
});
