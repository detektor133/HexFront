// Отношения и коалиции ботов (gdd/09-bots.md, «Дипломатия ботов»): обиды складываются из поступков,
// слабые объединяются против лидера, заклятый враг не союзник, свежая война не кончается миром,
// а лёгкий бот коалиций не строит.
import { describe, expect, it } from 'vitest';

import {
  ATTITUDE_MAX,
  ATT_BREACH_PUBLIC,
  ATT_WAR_ON_ME,
  BOT_PROFILES,
  BOT_PEACE_LOCK_TICKS,
  BOT_WAR_GRACE_TICKS,
  BOT_WAR_MIN_TICKS,
} from '../../src/balance.ts';
import { createBotTickContext } from '../../src/bots/context.ts';
import { diplomacyCommands } from '../../src/bots/diplomacy.ts';
import type { BotLevel } from '../../src/bots/types.ts';
import { applyCommands } from '../../src/commands/apply.ts';
import {
  attitudeOf,
  createDiplomacy,
  driftAttitudes,
  relationOf,
  setRelation,
  shiftAttitude,
} from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  C1: city('C', 1, { capital: true }),
  c: own('C'),
  D1: city('D', 1, { capital: true }),
  d: own('D'),
};

// A — огромная держава в центре, B, C, D — соседи поменьше; все касаются A.
const MAP = `
  B1 b  a  a  a  a  a  C1
  b  b  a  a  a  a  c  c
  a  a  a  A1 a  a  a  a
  a  a  a  a  a  a  a  a
  d  d  a  a  a  a  a  a
  D1 d  a  a  a  a  a  a
`;

function world() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  s.state.tick = BOT_WAR_GRACE_TICKS + 5000;
  for (let i = 0; i < 6; i += 1) s.unit('A', 'infantry', 600, at(3, 3));
  for (const who of ['B', 'C', 'D'])
    s.unit(who, 'infantry', 150, at(who === 'B' ? 0 : who === 'C' ? 7 : 0, who === 'D' ? 5 : 0));
  return s;
}

// Предложения бот делает в своём окне периода: подводим тик к его началу.
function commandsOf(s: ReturnType<typeof world>, me: number, level: BotLevel = 'medium') {
  const period = BOT_PROFILES[level].proposeEvery;
  s.state.tick -= (s.state.tick + me * 7) % period;
  return diplomacyCommands(s.state, me, createBotTickContext(s.state), level);
}

describe('отношения игроков', () => {
  it('война обижает жертву и её друзей, нарушение договора роняет доверие у всех', () => {
    const s = world();
    // C — союзник B: война A против B настроит и C против A.
    setRelation(s.state, 1, 2, 'alliance');
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    expect(attitudeOf(s.state, 1, 0)).toBeLessThanOrEqual(-ATT_WAR_ON_ME);
    expect(attitudeOf(s.state, 2, 0)).toBeLessThan(0);
    expect(attitudeOf(s.state, 0, 1)).toBe(0);

    // D с A был в пакте: нападение на D нарушает договор, и B с C уже не доверяют A сильнее.
    setRelation(s.state, 0, 3, 'pact');
    const before = attitudeOf(s.state, 2, 0);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 3 } }]);
    expect(attitudeOf(s.state, 2, 0)).toBeLessThanOrEqual(before - ATT_BREACH_PUBLIC);
  });

  it('отношение ограничено и остывает к нулю, у партнёров по договору растёт', () => {
    const s = world();
    shiftAttitude(s.state, 1, 0, -5 * ATTITUDE_MAX);
    expect(attitudeOf(s.state, 1, 0)).toBe(-ATTITUDE_MAX);
    driftAttitudes(s.state);
    expect(attitudeOf(s.state, 1, 0)).toBe(-ATTITUDE_MAX + 1);

    setRelation(s.state, 1, 2, 'pact');
    driftAttitudes(s.state);
    expect(attitudeOf(s.state, 1, 2)).toBeGreaterThan(0);
  });
});

describe('коалиции ботов', () => {
  it('слабые, воюющие с одним врагом, зовут друг друга в договор, а лидеру пакта не предлагают', () => {
    const s = world();
    setRelation(s.state, 1, 0, 'war');
    setRelation(s.state, 2, 0, 'war');
    const out = commandsOf(s, 1);
    expect(out).toContainEqual({ t: 'proposeTreaty', target: 2, kind: 'pact' });
    expect(out.some((c) => c.t === 'proposeTreaty' && c.target === 0 && c.kind !== 'peace')).toBe(
      false,
    );
  });

  it('лёгкий бот коалиций не строит: ни обороны, ни альянса', () => {
    const s = world();
    setRelation(s.state, 1, 2, 'pact');
    const out = commandsOf(s, 1, 'easy');
    expect(
      out.some((c) => c.t === 'proposeTreaty' && (c.kind === 'defense' || c.kind === 'alliance')),
    ).toBe(false);
  });

  it('пакт перерастает в оборонительный пакт, когда оба боятся лидера', () => {
    const s = world();
    setRelation(s.state, 1, 2, 'pact');
    shiftAttitude(s.state, 1, 2, 300);
    const out = commandsOf(s, 1);
    expect(out).toContainEqual({ t: 'proposeTreaty', target: 2, kind: 'defense' });
  });

  it('заклятому врагу пакт не светит, даже когда оба боятся лидера', () => {
    const s = world();
    shiftAttitude(s.state, 1, 2, -800);
    s.state.diplomacy?.offers.push({ from: 2, to: 1, kind: 'pact', tick: s.state.tick });
    const out = commandsOf(s, 1);
    expect(out).toContainEqual({ t: 'answerTreaty', from: 2, accept: false });
  });

  it('союзник, ставший лидером, исключается голосованием или предаётся', () => {
    const s = world();
    // B в оборонительном пакте с A: у сложного бота такой договор рвётся, когда A оторвался от всех.
    setRelation(s.state, 1, 0, 'defense');
    s.state.tick = BOT_WAR_GRACE_TICKS + 9000;
    const out = commandsOf(s, 1);
    expect(out).toContainEqual({ t: 'breakTreaty', target: 0 });
    // Нормальный бот так не делает: он оппортунистом не является.
    expect(commandsOf(s, 1, 'normal')).not.toContainEqual({ t: 'breakTreaty', target: 0 });
  });
});

describe('война и мир ботов', () => {
  it('агрессор не соглашается на мир сразу после объявления войны', () => {
    const s = world();
    setRelation(s.state, 0, 1, 'war');
    s.state.diplomacy?.offers.push({ from: 1, to: 0, kind: 'peace', tick: s.state.tick });
    expect(commandsOf(s, 0)).toContainEqual({ t: 'answerTreaty', from: 1, accept: false });

    // Через время войны, когда она затянулась, победитель устаёт и принимает.
    s.state.tick += BOT_WAR_MIN_TICKS * 8;
    s.state.diplomacy?.offers.splice(0);
    s.state.diplomacy?.offers.push({ from: 1, to: 0, kind: 'peace', tick: s.state.tick });
    expect(commandsOf(s, 0)).toContainEqual({ t: 'answerTreaty', from: 1, accept: true });
  });

  it('с кем только что помирился, на того не нападает', () => {
    const s = world();
    s.state.tick = BOT_WAR_GRACE_TICKS + 5000;
    setRelation(s.state, 0, 2, 'war');
    setRelation(s.state, 0, 2, 'peace');
    s.state.tick += 10;
    const fresh = commandsOf(s, 0).filter((c) => c.t === 'declareWar');
    expect(fresh.some((c) => c.t === 'declareWar' && c.target === 2)).toBe(false);
    expect(BOT_PEACE_LOCK_TICKS).toBeGreaterThan(0);
  });

  it('сложный бот ведёт больше войн сразу, чем лёгкий и нормальный', () => {
    const s = world();
    const wars = (level: BotLevel): number => {
      const state = world().state;
      let count = 0;
      for (let round = 0; round < 3; round += 1) {
        const declared = diplomacyCommands(state, 0, createBotTickContext(state), level).find(
          (c) => c.t === 'declareWar',
        );
        if (declared?.t !== 'declareWar') break;
        applyCommands(state, [{ playerId: 0, cmd: declared }]);
        count += 1;
      }
      return count;
    };
    expect(wars('easy')).toBeLessThanOrEqual(wars('normal'));
    expect(wars('normal')).toBeLessThanOrEqual(wars('medium'));
    expect(wars('medium')).toBeGreaterThan(wars('easy'));
    expect(relationOf(s.state, 0, 1)).toBe('peace');
  });
});
