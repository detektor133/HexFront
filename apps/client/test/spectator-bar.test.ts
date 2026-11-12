import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PlayerView } from '@hexfront/sim';

import { SpectatorBar, neighbour, watchOrder } from '../src/match/SpectatorBar.tsx';

function viewOf(
  players: readonly { id: number; status: 'alive' | 'eliminated' }[],
  places: readonly number[],
): PlayerView {
  return {
    players,
    ranking: places.map((id, index) => ({ id, place: index + 1, score: 0 })),
  } as unknown as PlayerView;
}

describe('панель наблюдателя', () => {
  it('листает только живых игроков по месту в таблице', () => {
    const view = viewOf(
      [
        { id: 0, status: 'eliminated' },
        { id: 1, status: 'alive' },
        { id: 2, status: 'alive' },
        { id: 3, status: 'alive' },
      ],
      [2, 0, 3, 1],
    );
    expect(watchOrder(view)).toEqual([2, 3, 1]);
  });

  it('соседи идут по кругу в обе стороны', () => {
    const order = [2, 3, 1];
    expect(neighbour(order, 2, 1)).toBe(3);
    expect(neighbour(order, 1, 1)).toBe(2);
    expect(neighbour(order, 2, -1)).toBe(1);
    expect(neighbour(order, 9, 1)).toBe(2);
    expect(neighbour([], 0, 1)).toBeNull();
  });
});

describe('разметка панели наблюдателя', () => {
  it('показывает имя наблюдаемого и две кнопки с подписями', () => {
    const view = {
      playerId: 1,
      players: [
        { id: 0, name: 'Аня', status: 'alive' },
        { id: 1, name: 'Борис', status: 'alive' },
      ],
      ranking: [],
    } as unknown as PlayerView;
    const html = renderToStaticMarkup(createElement(SpectatorBar, { view, onWatch: () => {} }));
    expect(html).toContain('Борис');
    expect(html).toContain('Предыдущий игрок');
    expect(html).toContain('Следующий игрок');
  });
});
