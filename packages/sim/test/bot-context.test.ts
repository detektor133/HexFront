import { describe, expect, it } from 'vitest';

import { at, city, own, scenario } from './scenario/dsl.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import { playerPlace, playerScore } from '../src/queries/score.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('контекст тика ботов', () => {
  it('индексирует несколько игроков и сохраняет пустые списки', () => {
    const match = scenario(
      `
        A1 a  .  .  B1 b
        a  a  .  .  b  b
      `,
      { legend },
    );
    const context = createBotTickContext(match.state);

    expect(context.ownedHexes[0]).toHaveLength(4);
    expect(context.ownedHexes[1]).toHaveLength(4);
    expect(context.borderHexes[0]).toHaveLength(2);
    expect(context.borderHexes[1]).toHaveLength(2);
    expect(context.unitsByPlayer[0]).toEqual([]);
    expect(context.armiesByPlayer[0]).toEqual([]);
    expect(context.plansByPlayer[1]).toEqual([]);
    expect(context.citiesByPlayer[0]?.[0]?.hex).toBe(0);
    expect(context.unitsByHex).toHaveLength(match.state.map.width * match.state.map.height);
    expect(context.viewsByPlayer).toHaveLength(match.state.players.length);
  });

  it('хранит отряды гекса без повторного поиска по общему списку', () => {
    const match = scenario('A1 a  .  B1 b', { legend });
    const unitId = match.unit('A', 'infantry', 10, at(1, 0));
    const unit = match.state.units.find((candidate) => candidate.id === unitId);
    expect(unit).toBeDefined();
    const context = createBotTickContext(match.state);

    expect(context.unitsByHex[unit?.hex ?? -1]).toEqual([unit]);
    expect(context.unitsByPlayer[0]).toEqual([unit]);
  });

  it('считает очки и места один раз в общем контексте', () => {
    const match = scenario('A1 a  .  B1 b', { legend });
    const context = createBotTickContext(match.state);

    expect([...context.playerView.scores]).toEqual(
      match.state.players.map((player) => playerScore(match.state, player.id)),
    );
    expect([...context.playerView.places]).toEqual(
      match.state.players.map((player) => playerPlace(match.state, player.id)),
    );
  });
});
