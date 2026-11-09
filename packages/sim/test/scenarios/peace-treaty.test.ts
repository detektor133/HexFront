import { describe, expect, it } from 'vitest';

import { applyCommands, validate } from '../../src/commands/apply.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { createDiplomacy, relationOf } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function game() {
  const s = scenario('A1 a  b  B1', { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  s.unit('A', 'infantry', 100, at(1, 0));
  return s;
}

describe('мир после войны', () => {
  it('в войне предлагается мир, а не пакт о ненападении', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    expect(validate(s.state, 0, { t: 'proposeTreaty', target: 1, kind: 'peace' }).ok).toBe(true);
    expect(validate(s.state, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' }).ok).toBe(false);
    expect(validate(s.state, 0, { t: 'proposeTreaty', target: 1, kind: 'alliance' }).ok).toBe(
      false,
    );
  });

  it('принятое предложение мира возвращает обычный мир и снимает атаки', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'proposeTreaty', target: 1, kind: 'peace' } },
    ]);
    applyCommands(s.state, [{ playerId: 1, cmd: { t: 'answerTreaty', from: 0, accept: true } }]);
    expect(relationOf(s.state, 0, 1)).toBe('peace');
  });

  it('предложение выбывшего игрока пропадает из вида адресата', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'proposeTreaty', target: 1, kind: 'pact' } }]);
    expect(playerView(s.state, 1).diplomacy?.incoming).toHaveLength(1);
    const proposer = s.state.players[0];
    if (proposer) proposer.status = 'eliminated';
    expect(playerView(s.state, 1).diplomacy?.incoming).toHaveLength(0);
  });

  it('в мире мир предложить нельзя, а пакт можно', () => {
    const s = game();
    expect(validate(s.state, 0, { t: 'proposeTreaty', target: 1, kind: 'peace' }).ok).toBe(false);
    expect(validate(s.state, 0, { t: 'proposeTreaty', target: 1, kind: 'pact' }).ok).toBe(true);
  });
});
