import { describe, expect, it } from 'vitest';

import { buildTerritoryLabels } from '../src/dev/territory-labels.ts';

describe('подписи территорий', () => {
  it('строит один центроид на владельца и пропускает нейтральные гексы и игроков без территории', () => {
    const labels = buildTerritoryLabels(
      {
        hexes: { owner: Int16Array.from([0, 0, 1, -1]) },
        players: [
          { id: 0, name: 'Север' },
          { id: 1, name: 'Юг' },
          { id: 2, name: 'Без земли' },
        ],
      } as never,
      2,
      10,
    );

    expect(labels).toHaveLength(2);
    expect(labels.map((label) => label.name)).toEqual(['Север', 'Юг']);
    expect(labels[0]?.at).toEqual({ x: 7.5, y: -4.330127018922193 });
    expect(labels[1]?.at).toEqual({ x: 0, y: 17.32050807568877 });
  });
});
