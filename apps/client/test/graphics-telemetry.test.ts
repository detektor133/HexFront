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

  it('одна перерисовка из многих фигур считается одним перестроением', async () => {
    const graphics = new Graphics();
    graphicsTelemetry(graphics, 1000);

    graphics.clear();
    for (let i = 0; i < 500; i += 1) graphics.rect(i, 0, 1, 1);
    graphics.fill(0xffffff);
    await Promise.resolve();
    graphics.clear();
    await Promise.resolve();

    expect(graphicsTelemetry(graphics, 2000).rebuildsPerSecond).toBe(2);
  });
});
