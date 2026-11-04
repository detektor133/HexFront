import { describe, expect, it } from 'vitest';

import { BOT_WAR_GRACE_TICKS } from '../../src/balance.ts';
import { createBotTickContext } from '../../src/bots/context.ts';
import { diplomacyCommands } from '../../src/bots/diplomacy.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
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

function setup(strong: number, weak: number) {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (let i = 0; i < strong; i += 1) s.unit('A', 'infantry', 400, at(1, 0));
  for (let i = 0; i < weak; i += 1) s.unit('B', 'infantry', 100, at(4, 0));
  return s;
}

describe('дипломатия ботов', () => {
  it('в льготный период бот не объявляет войну', () => {
    const s = setup(2, 1);
    expect(diplomacyCommands(s.state, 0, createBotTickContext(s.state))).not.toContainEqual({
      t: 'declareWar',
      target: 1,
    });
  });

  it('сильный сосед объявляет войну слабому, слабый предлагает ему пакт', () => {
    const s = setup(2, 1);
    s.state.tick = BOT_WAR_GRACE_TICKS;
    const ctx = createBotTickContext(s.state);
    const strongCmds = diplomacyCommands(s.state, 0, ctx);
    expect(strongCmds).toContainEqual({ t: 'declareWar', target: 1 });
    // Окно предложений: тик 0 (tick % период < BOT_EASY_THINK_TICKS).
    const weakCmds = diplomacyCommands(s.state, 1, ctx);
    expect(weakCmds).toContainEqual({ t: 'proposeTreaty', target: 0, kind: 'pact' });
    expect(weakCmds.some((c) => c.t === 'declareWar')).toBe(false);
  });

  it('слабый бот принимает пакт от сильного: опасность больше выгоды', () => {
    const s = setup(2, 1);
    s.state.diplomacy?.offers.push({ from: 0, to: 1, kind: 'pact', tick: 0 });
    const out = diplomacyCommands(s.state, 1, createBotTickContext(s.state));
    expect(out).toContainEqual({ t: 'answerTreaty', from: 0, accept: true });
  });
});
