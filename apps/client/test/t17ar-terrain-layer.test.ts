import { readFileSync } from 'node:fs';

import { GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { detailLevel } from '../src/render/camera.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { createTerrainLayer } from '../src/render/terrain-layer.ts';
import { tokens } from '../src/theme/tokens.ts';

const loaded = loadMap({
  version: 1,
  id: 't17ar-terrain-patterns',
  width: 5,
  height: 1,
  terrain: 'AQIDBAU=',
  features: [],
  riverEdges: [],
  roads: 'AA==',
  cities: [],
  spawns: [{ q: 0, r: 0 }],
});
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

const SCALES = [1.5, tokens.map.zoom.max] as const;
const DPR = 2;

function recordPatternCalls(): {
  readonly circles: ReturnType<typeof vi.spyOn>;
  readonly curves: ReturnType<typeof vi.spyOn>;
  readonly lines: ReturnType<typeof vi.spyOn>;
  readonly moves: ReturnType<typeof vi.spyOn>;
  readonly strokes: ReturnType<typeof vi.spyOn>;
} {
  return {
    circles: vi.spyOn(GraphicsContext.prototype, 'circle'),
    curves: vi.spyOn(GraphicsContext.prototype, 'quadraticCurveTo'),
    lines: vi.spyOn(GraphicsContext.prototype, 'lineTo'),
    moves: vi.spyOn(GraphicsContext.prototype, 'moveTo'),
    strokes: vi.spyOn(GraphicsContext.prototype, 'stroke'),
  };
}

function expectPhysicalCoordinates(
  calls: ReturnType<typeof recordPatternCalls>,
  scale: number,
): void {
  const factor = scale * DPR;
  const endpoints = [
    ...calls.moves.mock.calls.map((args: unknown[]) => [args[0], args[1]]),
    ...calls.circles.mock.calls.map((args: unknown[]) => [args[0], args[1]]),
    ...calls.curves.mock.calls.map((args: unknown[]) => [args[2], args[3]]),
    ...calls.lines.mock.calls.map((args: unknown[]) => [args[0], args[1]]),
  ];
  for (const [x, y] of endpoints) {
    expect(Number.isInteger(Number(x) * factor)).toBe(true);
    expect(Number.isInteger(Number(y) * factor)).toBe(true);
  }
}

describe('T17ar: процедурные паттерны рельефа', () => {
  it('Приёмка: лес на detail === 3 пересобирается на масштабах 1,5 и map.zoom.max', () => {
    for (const scale of SCALES) {
      const calls = recordPatternCalls();
      const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);
      calls.circles.mockClear();

      layer.update(scale, detailLevel(scale));

      expect(detailLevel(scale)).toBe(3);
      expect(calls.circles).toHaveBeenCalledTimes(3);
      layer.destroy();
      vi.restoreAllMocks();
    }
  });

  it('Приёмка: холмы на detail === 3 пересобираются на масштабах 1,5 и map.zoom.max', () => {
    for (const scale of SCALES) {
      const calls = recordPatternCalls();
      const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);
      calls.curves.mockClear();

      layer.update(scale, detailLevel(scale));

      expect(detailLevel(scale)).toBe(3);
      expect(calls.curves).toHaveBeenCalled();
      layer.destroy();
      vi.restoreAllMocks();
    }
  });

  it('Приёмка: горы на detail === 3 пересобираются на масштабах 1,5 и map.zoom.max', () => {
    for (const scale of SCALES) {
      const calls = recordPatternCalls();
      const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);
      calls.lines.mockClear();

      layer.update(scale, detailLevel(scale));

      expect(detailLevel(scale)).toBe(3);
      expect(calls.lines).toHaveBeenCalled();
      layer.destroy();
      vi.restoreAllMocks();
    }
  });

  it('Приёмка: пустыня на detail === 3 пересобирается на масштабах 1,5 и map.zoom.max', () => {
    for (const scale of SCALES) {
      const calls = recordPatternCalls();
      const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);
      calls.curves.mockClear();

      layer.update(scale, detailLevel(scale));

      expect(detailLevel(scale)).toBe(3);
      const desertCenter = hexCenter(hexFromId(4, loaded.map.width), tokens.map.hexRadius);
      const desertCurves = calls.curves.mock.calls.filter((args: unknown[]) => {
        const endX = Number(args[2]);
        const endY = Number(args[3]);
        return Math.hypot(endX - desertCenter.x, endY - desertCenter.y) < tokens.map.hexRadius;
      });
      expect(desertCurves).toHaveLength(4);
      layer.destroy();
      vi.restoreAllMocks();
    }
  });

  it('Приёмка: координаты конечных точек после учёта devicePixelRatio — целые физические пиксели, а ширина линии — tokens.map.patternWidth экранных px', () => {
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: DPR });
    for (const scale of SCALES) {
      const calls = recordPatternCalls();
      const layer = createTerrainLayer(loaded.map, tokens.map.hexRadius);
      calls.circles.mockClear();
      calls.curves.mockClear();
      calls.lines.mockClear();
      calls.strokes.mockClear();

      layer.update(scale, 3);

      expectPhysicalCoordinates(calls, scale);
      const patternStroke = calls.strokes.mock.calls.find((args: unknown[]) => {
        const [style] = args;
        return style && typeof style === 'object' && 'color' in style;
      });
      expect(patternStroke?.[0]).toMatchObject({ width: tokens.map.patternWidth / scale });
      layer.destroy();
      vi.restoreAllMocks();
    }
  });

  it('Правило родителя: слой не использует Texture, canvas-растер или кэширование ранее созданного паттерна', () => {
    const source = readFileSync(new URL('../src/render/terrain-layer.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(
      /cacheAsTexture|new\s+Texture|document\.createElement\(['"]canvas['"]\)/u,
    );
  });
});
