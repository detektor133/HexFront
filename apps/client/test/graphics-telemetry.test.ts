import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { graphicsTelemetry } from '../src/render/graphics-telemetry.ts';

describe('телеметрия Graphics', () => {
  it('возвращает число вершин и частоту перестроений геометрии', () => {
    const graphics = new Graphics();
    const first = graphicsTelemetry(graphics, 1000);

    graphics.clear();
    const second = graphicsTelemetry(graphics, 2000);

    expect(first).toMatchObject({
      id: graphics.context.uid,
      instructions: 0,
      vertices: 0,
      rebuildsPerSecond: 0,
    });
    expect(second.vertices).toBe(0);
    expect(second.rebuildsPerSecond).toBe(1);
  });
});
