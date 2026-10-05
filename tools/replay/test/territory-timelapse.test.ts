import { describe, expect, it } from 'vitest';

import { renderTerritoryTimelapse } from '../src/territory-timelapse.ts';

describe('таймлапс территории', () => {
  it('создаёт PNG-сетку с кадрами', () => {
    const png = renderTerritoryTimelapse(
      2,
      1,
      [1, 0],
      [
        { t: 0, owner: [-1, 0] },
        { t: 60, owner: [1, 0] },
      ],
      { background: '#ffffff', terrain: ['#000000', '#eeeeee'], players: ['#ff0000', '#0000ff'] },
    );
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBeGreaterThan(0);
  });

  it('отклоняет пустой набор кадров', () => {
    expect(() =>
      renderTerritoryTimelapse(2, 1, [1, 0], [], {
        background: '#ffffff',
        terrain: ['#000000', '#eeeeee'],
        players: ['#ff0000'],
      }),
    ).toThrow('нет кадров');
  });
});
