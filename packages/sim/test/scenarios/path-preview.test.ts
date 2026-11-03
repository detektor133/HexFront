import { describe, expect, it } from 'vitest';

import { previewPath } from '../../src/queries/path-preview.ts';
import { hashState } from '../../src/state/hash.ts';
import { at, city, move, own, raw, road, scenario } from '../scenario/dsl.ts';

const LINE = `
  A1 a  r  r  r  a  a  a
  a  a  a  a  a  a  a  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
};
const make = () => scenario(LINE, { legend });
const id = (s: ReturnType<typeof make>, col: number, row: number): number =>
  col + row * s.state.map.width;

function actualTicks(s: ReturnType<typeof make>, unit: number, to: number): number {
  for (let t = 1; t <= 2000; t += 1) {
    s.runTicks(1);
    if (s.unitById(unit)?.hex === to) return t;
  }
  return -1;
}

describe('предпросмотр пути и времени', () => {
  it('время совпадает с фактическим на равнине и дороге, состояние и хэш не меняются', () => {
    for (const to of [id(make(), 2, 1), id(make(), 4, 0)]) {
      const s = make();
      const unit = s.unit('A', 'infantry', 100, at(0, 0));
      const before = hashState(s.state);
      const preview = previewPath(s.state, 0, [unit], to);
      expect(hashState(s.state)).toBe(before);
      s.cmd('A', move([{ unitOf: 'A', index: 0 }], { col: to % 8, row: Math.floor(to / 8) }));
      expect(preview?.path.at(-1)).toBe(to);
      expect(actualTicks(s, unit, to)).toBe(preview?.ticks);
    }
  });

  it('маршрут через точки и самый медленный отряд определяют время', () => {
    const s = make();
    const slow = s.unit('A', 'artillery', 100, at(0, 0));
    const fast = s.unit('A', 'infantry', 100, at(0, 0));
    const direct = previewPath(s.state, 0, [fast], id(s, 5, 0));
    const via = previewPath(s.state, 0, [fast], id(s, 5, 0), [id(s, 6, 1)]);
    const both = previewPath(s.state, 0, [slow, fast], id(s, 5, 0));

    expect(via?.ticks).toBeGreaterThan(direct?.ticks ?? Infinity);
    expect(via?.path).toContain(id(s, 6, 1));
    const slowAlone = previewPath(s.state, 0, [slow], id(s, 5, 0));
    expect(both?.ticks).toBe(Math.max(slowAlone?.ticks ?? 0, direct?.ticks ?? 0));
  });

  it('enemyOnPath учитывает только видимого игроку врага', () => {
    const s = make();
    const unit = s.unit('A', 'infantry', 100, at(5, 1));
    s.unit('B', 'infantry', 100, at(6, 1));
    const enemyHex = id(s, 6, 1);
    expect(previewPath(s.state, 0, [unit], enemyHex)?.enemyOnPath).toBe(true);

    s.state.fog = true;
    s.state.vision = { visible: [new Uint8Array(s.state.hexes.owner.length)] } as never;
    expect(previewPath(s.state, 0, [unit], enemyHex)?.enemyOnPath).toBe(false);
    expect(raw).toBeDefined();
  });
});
