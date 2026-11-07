import { describe, expect, it } from 'vitest';

import { glyphCodes, packChip } from '../src/dev/chip-gpu.ts';
import { chipLayout } from '../src/dev/chip-layout.ts';
import { createChip, type ChipState } from '../src/dev/unit-chips.ts';
import { formatSoldiers } from '../src/i18n/format.ts';

const base: ChipState = {
  color: '#3A6EA5',
  army: '#B4532A',
  type: 'infantry',
  soldiers: 1_234_000,
  org: 0.6,
  supply: 0.8,
  starving: false,
  selected: false,
  retreating: false,
  encircled: false,
  ghost: false,
};

const variants: ChipState[] = [
  base,
  { ...base, army: null, supply: null },
  { ...base, stars: 2, count: 3 },
  { ...base, attackDirection: 2, soldiers: 12_000_000 },
  { ...base, soldiers: 999_000, selected: true, type: 'artillery' },
  { ...base, soldiers: 4_500, retreating: true, supply: 0.2 },
  { ...base, stars: 1, army: null },
];

describe('фишки на GPU: раскладка', () => {
  it('ширина фишки совпадает с рисованием на процессоре в обычном виде и свёрнутой', () => {
    Object.assign(globalThis, { window: { devicePixelRatio: 1 } });
    for (const state of variants) {
      for (const compact of [false, true]) {
        const chip = createChip();
        chip.setCompact(compact);
        chip.draw(state);
        const label = formatSoldiers(state.soldiers);
        expect(chipLayout(state, label.length, compact).width, JSON.stringify(state)).toBeCloseTo(
          chip.width(),
          6,
        );
        chip.destroy();
      }
    }
  });

  it('призрак набора не ловит нажатия: ширина 0', () => {
    const ghost: ChipState = { ...base, ghost: true, army: null, supply: null };
    expect(chipLayout(ghost, 3, false).width).toBe(0);
  });

  it('символы подписи кодируются по атласу, лишнее добивается минус единицей', () => {
    expect(glyphCodes('12', 4)).toEqual([1, 2, -1, -1]);
    expect(glyphCodes('1,5к', 6)).toEqual([1, 11, 5, 12, -1, -1]);
  });

  it('свойства фишки пакуются в буфер: геометрия, флаги, столбики, цвет', () => {
    const out = new Float32Array(40);
    const { width } = packChip(
      out,
      0,
      { ...base, selected: true, count: 4, attackDirection: 1 },
      false,
    );
    expect(width).toBeGreaterThan(60);
    expect(out[0]).toBeGreaterThan(40);
    expect(out[1]).toBe(0);
    expect(out[3]).toBeCloseTo(chipLayout({ ...base, attackDirection: 1 }, 5, false).labelCx, 3);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 1, 4]);
    expect(out[8]).toBe(1);
    expect(out[12]).toBeCloseTo(0.6, 5);
    expect(out[13]).toBeCloseTo(0.8, 5);
    expect(packChip(new Float32Array(40), 0, { ...base, ghost: true }, true).width).toBe(0);
  });
});
