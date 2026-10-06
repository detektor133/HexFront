import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { createChip } from '../src/dev/unit-chips.ts';

const SOURCE_ROOT = new URL('../src/', import.meta.url);

function sourceFiles(): Array<{ name: string; source: string }> {
  return readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/u.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      source: readFileSync(join(entry.parentPath, entry.name), 'utf8'),
    }));
}

describe('освобождение контекстов Graphics', () => {
  it('уничтожает контекст фишки', () => {
    Object.assign(globalThis, { window: { devicePixelRatio: 1 } });
    const chip = createChip();
    const graphics = chip.root.children[0]?.children[0] as Graphics;
    const context = graphics.context;

    chip.destroy();

    expect(context?.destroyed).toBe(true);
  });

  it('уничтожает контекст плашки прогноза', () => {
    const container = new Container();
    const graphics = new Graphics();
    const plate = new Container();
    plate.addChild(graphics);
    container.addChild(plate);
    const context = graphics.context;

    plate.destroy({ children: true, context: true });

    expect(context?.destroyed).toBe(true);
  });

  it('батчит контекст фишки и плашки прогноза', () => {
    Object.assign(globalThis, { window: { devicePixelRatio: 1 } });
    const chip = createChip();
    const chipGraphics = chip.root.children[0]?.children[0] as Graphics;

    expect(chipGraphics.context.batchMode).toBe('batch');
    expect(sourceFiles().find(({ name }) => name === 'forecast-plate.ts')?.source).toMatch(
      /new Graphics\(\);\s+g\.context\.batchMode = 'batch';/su,
    );
  });

  it('не создаёт мелкие динамические Graphics без batch mode', () => {
    const dynamicSources = sourceFiles().filter(({ name }) =>
      ['unit-chips.ts', 'forecast-plate.ts'].includes(name),
    );

    for (const { source } of dynamicSources) {
      expect(source).toMatch(/new Graphics\(\);\s*g\.context\.batchMode\s*=\s*'batch'/su);
    }
  });

  it('не оставляет destroy с children без context', () => {
    const unsafeDestroy = /\.destroy\(\{\s*children\s*:\s*true\s*\}\)/u;

    expect(sourceFiles().some(({ source }) => unsafeDestroy.test(source))).toBe(false);
  });
});
