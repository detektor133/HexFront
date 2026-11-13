import { describe, expect, it } from 'vitest';

import { readSandboxMap } from '../src/dev/sandbox-map.ts';
import { mapUrl } from '../src/local/map-request.ts';

describe('параметры карты песочницы', () => {
  it('передаёт сид, число игроков и размер для случайной карты', () => {
    const request = readSandboxMap('?map=gen&seed=17&players=30&size=60');

    expect(request).toEqual({ id: 'gen', seed: 17, players: 30, size: 60 });
  });

  it('ограничивает число игроков и размер диапазоном генератора', () => {
    expect(readSandboxMap('?map=gen&players=1').players).toBe(2);
    expect(readSandboxMap('?map=gen&players=99').players).toBe(60);
    expect(readSandboxMap('?map=gen&size=1').size).toBe(4);
    expect(readSandboxMap('?map=gen').size).toBe(30);
  });

  it('сохраняет small без параметра map', () => {
    const request = readSandboxMap('');

    expect(request.id).toBe('small');
    expect(mapUrl(request)).toBe('/maps/small.json');
  });
});
