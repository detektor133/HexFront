import { readFileSync } from 'node:fs';

import { Graphics } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { createEconomyLayer } from '../src/dev/economy-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { tokens } from '../src/theme/tokens.ts';

const small = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as unknown;
const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

function viewWithConstructions(constructionCount: number): PlayerView {
  const arcConstructions = [
    { hex: 0, kind: 'city', owner: 0, progressTicks: 1, totalTicks: 10 },
    { hex: 1, kind: 'improvement', owner: 0, progressTicks: 2, totalTicks: 10 },
    { hex: 2, kind: 'fort', owner: 0, progressTicks: 3, totalTicks: 10 },
  ].slice(0, constructionCount);
  const constructions = [
    ...arcConstructions,
    { hex: 3, kind: 'road', owner: 0, progressTicks: 3, totalTicks: 10, path: [3, 4] },
  ];

  const engine = createLocalEngine(small, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const message = engine.tick();
  if (message.t !== 'view') throw new Error('ожидался снимок');
  return { ...message.view, constructions } as unknown as PlayerView;
}

function assertArcStartsOnItsCircle(
  arcCalls: ReadonlyArray<unknown[]>,
  moveCalls: ReadonlyArray<unknown[]>,
  arcOrders: ReadonlyArray<number>,
  moveOrders: ReadonlyArray<number>,
  expectedArcCount: number,
): void {
  expect(arcCalls).toHaveLength(expectedArcCount);
  for (const [[x, y, radius], arcOrder] of arcCalls.map(
    (call, index) => [call, arcOrders[index] as number] as const,
  )) {
    const moveIndex = moveOrders.reduce(
      (lastIndex, moveOrder, index) => (moveOrder < arcOrder ? index : lastIndex),
      -1,
    );
    const move = moveCalls[moveIndex];
    expect(move).toBeDefined();
    const [moveX, moveY] = move as [number, number];
    expect(Math.hypot(moveX - (x as number), moveY - (y as number))).toBeCloseTo(radius as number);
  }
}

describe('дуги прогресса строек', () => {
  it('для двух строек и одной дороги начинает каждую дугу с точки её окружности', () => {
    const arc = vi.spyOn(Graphics.prototype, 'arc');
    const moveTo = vi.spyOn(Graphics.prototype, 'moveTo');
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);

    layer.setView(viewWithConstructions(2), { hex: null, units: [], target: null });

    assertArcStartsOnItsCircle(
      arc.mock.calls,
      moveTo.mock.calls,
      arc.mock.invocationCallOrder,
      moveTo.mock.invocationCallOrder,
      2,
    );
    layer.destroy();
    arc.mockRestore();
    moveTo.mockRestore();
  });

  it('для трёх строек и одной дороги не оставляет дугу продолжением предыдущего пути', () => {
    const arc = vi.spyOn(Graphics.prototype, 'arc');
    const moveTo = vi.spyOn(Graphics.prototype, 'moveTo');
    const layer = createEconomyLayer(loaded.map, tokens.map.hexRadius);

    layer.setView(viewWithConstructions(3), { hex: null, units: [], target: null });

    assertArcStartsOnItsCircle(
      arc.mock.calls,
      moveTo.mock.calls,
      arc.mock.invocationCallOrder,
      moveTo.mock.invocationCallOrder,
      3,
    );
    layer.destroy();
    arc.mockRestore();
    moveTo.mockRestore();
  });
});

describe('сторож начала дугового пути', () => {
  it('требует moveTo после stroke или fill перед дугой в трёх слоях Graphics', () => {
    const files = ['dev/economy-layer.ts', 'dev/plan-layer.ts', 'dev/unit-chips.ts'];
    for (const file of files) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      for (const arcPosition of [...source.matchAll(/\.arc\(/gu)].map(
        (match) => match.index ?? 0,
      )) {
        const pathBeforeArc = source.slice(Math.max(0, arcPosition - 500), arcPosition);
        const lastPathBreak = Math.max(
          pathBeforeArc.lastIndexOf('.clear('),
          pathBeforeArc.lastIndexOf('{'),
        );
        const path = pathBeforeArc.slice(lastPathBreak);
        const lastMove = path.lastIndexOf('.moveTo(');
        const lastStroke = Math.max(path.lastIndexOf('.stroke('), path.lastIndexOf('.fill('));
        expect(lastStroke, `${file}: дуга без предшествующего пути`).toBeLessThan(lastMove);
      }
    }
  });
});
