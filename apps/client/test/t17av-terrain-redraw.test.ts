import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTerrainRedrawGate } from '../src/render/terrain-redraw.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('T17av: плавный зум после чёткой детализации рельефа', () => {
  it('не перестраивает рельеф на разных масштабах внутри одного detail-уровня до конца жеста', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1.5, 3, 0)).toBe(true);
    expect(gate.shouldRedraw(1.6, 3, 20)).toBe(false);
    expect(gate.shouldRedraw(1.8, 3, 40)).toBe(false);
    expect(gate.shouldRedraw(2, 3, 60)).toBe(false);
  });

  it('после периода покоя выполняет ровно одну перестройку на последнем масштабе', () => {
    const gate = createTerrainRedrawGate();

    gate.shouldRedraw(1.5, 3, 0);
    gate.shouldRedraw(1.6, 3, 20);
    gate.shouldRedraw(2, 3, 60);

    expect(gate.shouldRedraw(2, 3, 60 + tokens.motion.ui - 1)).toBe(false);
    expect(gate.shouldRedraw(2, 3, 60 + tokens.motion.ui)).toBe(true);
    expect(gate.shouldRedraw(2, 3, 60 + tokens.motion.ui + 1)).toBe(false);
  });

  it('немедленно перестраивает рельеф при переходе detail-уровня', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1.4, 2, 0)).toBe(true);
    expect(gate.shouldRedraw(1.49, 2, 20)).toBe(false);
    expect(gate.shouldRedraw(1.5, 3, 40)).toBe(true);
  });

  it('не перестраивает рельеф на повторном кадре без изменения масштаба', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1.5, 3, 0)).toBe(true);
    expect(gate.shouldRedraw(1.5, 3, 16)).toBe(false);
  });

  it('не добавляет растровые текстуры, canvas или новые цвета в модуль перестройки', () => {
    const source = readFileSync(
      new URL('../src/render/terrain-redraw.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/Texture|createElement\s*\(\s*['"]canvas['"]|#[0-9a-f]{3,8}\b/iu);
  });
});
