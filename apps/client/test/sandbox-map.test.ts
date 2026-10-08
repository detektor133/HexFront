import { describe, expect, it } from 'vitest';

import { readSandboxMap, sandboxMapUrl } from '../src/dev/sandbox-map.ts';

describe('параметры карты песочницы', () => {
  it('передаёт сид и число игроков для процедурной карты', () => {
    const request = readSandboxMap('?map=gen&seed=17&players=30');

    expect(request).toEqual({ id: 'gen', seed: 17, players: 30 });
    expect(sandboxMapUrl(request)).toBe('/maps/gen.json?seed=17&players=30');
  });

  it('ограничивает число игроков диапазоном генератора', () => {
    expect(readSandboxMap('?map=gen&players=1').players).toBe(2);
    expect(readSandboxMap('?map=gen&players=31').players).toBe(30);
  });

  it('сохраняет small без параметра map', () => {
    const request = readSandboxMap('');

    expect(request.id).toBe('small');
    expect(sandboxMapUrl(request)).toBe('/maps/small.json');
  });
});
