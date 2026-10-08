import { describe, expect, it } from 'vitest';

import { readLocalMatchSetup } from '../src/local/match-setup.ts';

describe('настройка локального матча', () => {
  it('назначает игрока 0 человеком и остальных 29 игроков ботами', () => {
    const setup = readLocalMatchSetup('?map=gen&seed=42&players=30');

    expect(setup.count).toBe(30);
    expect(setup.bots).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
    expect(setup.speed).toBe(1);
  });

  it('сохраняет заданный сид и процедурную карту для запуска worker', () => {
    const setup = readLocalMatchSetup('?map=gen&seed=73&players=30');

    expect(setup.map).toEqual({ id: 'gen', seed: 73, players: 30 });
  });
});
