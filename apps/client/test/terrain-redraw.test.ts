import { describe, expect, it } from 'vitest';

import { createTerrainRedrawGate } from '../src/render/terrain-redraw.ts';
import { tokens } from '../src/theme/tokens.ts';

describe('T17av: отложенная перестройка рельефа при зуме', () => {
  it('не перестраивает рельеф во время жеста и один раз применяет конечный масштаб', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1.5, 3, 0)).toBe(true);
    expect(gate.shouldRedraw(1.6, 3, 20)).toBe(false);
    expect(gate.shouldRedraw(1.8, 3, 60)).toBe(false);
    expect(gate.shouldRedraw(2, 3, 100)).toBe(false);
    expect(gate.shouldRedraw(2, 3, 100 + tokens.motion.ui - 1)).toBe(false);
    expect(gate.shouldRedraw(2, 3, 100 + tokens.motion.ui)).toBe(true);
    expect(gate.shouldRedraw(2, 3, 100 + tokens.motion.ui + 1)).toBe(false);
  });

  it('перестраивает рельеф сразу при смене уровня детализации', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1.4, 2, 0)).toBe(true);
    expect(gate.shouldRedraw(1.49, 2, 20)).toBe(false);
    expect(gate.shouldRedraw(1.5, 3, 40)).toBe(true);
  });

  it('после reset немедленно строит первый кадр', () => {
    const gate = createTerrainRedrawGate();

    expect(gate.shouldRedraw(1, 2, 0)).toBe(true);
    gate.reset();
    expect(gate.shouldRedraw(1, 2, 1)).toBe(true);
  });
});
