import { describe, expect, it } from 'vitest';

import { NETWORK_RECALC_TICKS, TICKS_PER_S } from '../src/balance.ts';
import { at, city, own, rebuildSupply, road, scenario } from './scenario/dsl.ts';
import type { Fp } from '../src/math/int.ts';
import { canFoundCity, cityInfo, rebuildSupplyPreview } from '../src/queries/city.ts';
import { hashState } from '../src/state/hash.ts';
import { ROAD_TICKS_PER_HEX } from '../src/systems/road-construction.ts';

const MAP = `
  a  a  a  a  a  a  a  a  a  a  a  a  a
  a  A1 r  r  r  r  A2 a  a  a  a  a  a
  a  a  a  a  a  a  a  a  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), A2: city('A', 2), a: own('A'), r: road('A') };
const A1 = at(1, 1);
const A2 = at(6, 1);
const CUT = at(4, 1);

type S = ReturnType<typeof scenario>;
const hexOf = (s: S, w: { col: number; row: number }): number => w.col + w.row * s.state.map.width;
const cityId = (s: S, w: { col: number; row: number }): number => s.cityAt(w)?.id ?? -1;

function fresh(): S {
  const s = scenario(MAP, { legend });
  s.player('A').gold = (500 * 1000) as Fp;
  s.runTicks(1);
  return s;
}

describe('запросы для UI', () => {
  it('не меняют состояние', () => {
    const s = fresh();
    const before = hashState(s.state);
    canFoundCity(s.state, 0, hexOf(s, at(11, 2)));
    cityInfo(s.state, cityId(s, A2));
    rebuildSupplyPreview(s.state, 0, cityId(s, A2));
    expect(hashState(s.state)).toBe(before);
  });

  describe('canFoundCity', () => {
    it('даёт цену, когда основание возможно', () => {
      const s = fresh();
      const hex = at(11, 2);
      s.setPop(hex, 60);
      expect(canFoundCity(s.state, 0, hexOf(s, hex))).toEqual({
        ok: true,
        cost: 120_000,
        timeS: 30_000,
      });
    });

    it('даёт ту же причину отказа, что и команда', () => {
      const s = fresh();
      expect(canFoundCity(s.state, 0, hexOf(s, at(2, 1)))).toMatchObject({
        ok: false,
        reason: 'cityTooClose',
      });
      const far = at(11, 2);
      s.setPop(far, 10);
      expect(canFoundCity(s.state, 0, hexOf(s, far))).toMatchObject({
        ok: false,
        reason: 'popTooLow',
      });
    });
  });

  describe('cityInfo', () => {
    it('содержит поля карточки: уровень, население, рост, снабжение, золото, связь', () => {
      const s = fresh();
      s.setPop(A2, 300);
      const info = cityInfo(s.state, cityId(s, A2));
      expect(info).toMatchObject({
        level: 2,
        owner: 0,
        isCapital: false,
        pop: 300_000,
        popCap: 600_000,
        supply: 500_000,
        goldPerS: 1000,
        link: 'connected',
        roadJob: null,
        construction: null,
      });
      // Рост городского гекса L2: 3,0 × 1,25 × (1 − 300/600).
      expect(info?.growthPerS).toBe(1875);
    });

    it('рост в секунду согласован с системой роста', () => {
      const s = fresh();
      s.setPop(A2, 100);
      const rate = cityInfo(s.state, cityId(s, A2))?.growthPerS ?? 0;
      const before = s.pop(A2);
      s.runTicks(1);
      // Система усекает рост каждый тик: за секунду теряется меньше 1 FP на тик.
      const perSecond = (s.pop(A2) - before) * TICKS_PER_S;
      expect(Math.abs(perSecond - rate)).toBeLessThanOrEqual(TICKS_PER_S);
    });

    it('столица производит снабжение с бонусом', () => {
      const s = fresh();
      expect(cityInfo(s.state, cityId(s, A1))).toMatchObject({ isCapital: true, supply: 500_000 });
    });

    it('изолированный город: статус, снабжение и золото ×0,5, предпросмотр перестройки', () => {
      const s = fresh();
      s.setOwner(CUT, null);
      s.runTicks(NETWORK_RECALC_TICKS);
      const info = cityInfo(s.state, cityId(s, A2));
      expect(info).toMatchObject({ link: 'isolated', supply: 250_000, goldPerS: 500 });
      expect(info?.rebuild).toMatchObject({ ok: true });
    });

    it('перестройка идёт: прогресс «N из M» гексов', () => {
      const s = fresh();
      s.setOwner(CUT, null);
      s.runTicks(NETWORK_RECALC_TICKS);
      s.cmd('A', rebuildSupply(A2));
      s.runTicks(1);
      const start = cityInfo(s.state, cityId(s, A2))?.roadJob;
      expect(start?.built).toBe(0);
      const total = start?.total ?? 0;
      expect(total).toBeGreaterThan(0);
      s.runTicks(ROAD_TICKS_PER_HEX);
      const next = cityInfo(s.state, cityId(s, A2))?.roadJob;
      if (total > 1) expect(next).toEqual({ built: 1, total });
      else expect(next).toBeNull();
    });

    it('улучшение: цена и время следующего уровня или причина отказа', () => {
      const s = fresh();
      expect(cityInfo(s.state, cityId(s, A2))?.upgrade).toEqual({
        ok: true,
        cost: 200_000,
        timeS: 30_000,
      });
      s.player('A').gold = 0 as Fp;
      expect(cityInfo(s.state, cityId(s, A2))?.upgrade).toEqual({
        ok: false,
        reason: 'notEnoughGold',
        cost: 200_000,
        timeS: 30_000,
      });
    });

    it('несуществующий город — null', () => {
      expect(cityInfo(fresh().state, 999)).toBeNull();
    });
  });

  describe('rebuildSupplyPreview', () => {
    it('даёт путь и цену, даже если золота не хватает', () => {
      const s = fresh();
      s.setOwner(CUT, null);
      s.runTicks(NETWORK_RECALC_TICKS);
      s.player('A').gold = 0 as Fp;
      const preview = rebuildSupplyPreview(s.state, 0, cityId(s, A2));
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.affordable).toBe(false);
      expect(preview.path[0]).toBe(hexOf(s, A2));
      expect(preview.cost).toBe(15_000 * preview.toBuild.length);
    });

    it('город в основной сети — причина notIsolated', () => {
      const s = fresh();
      expect(rebuildSupplyPreview(s.state, 0, cityId(s, A2))).toMatchObject({
        ok: false,
        reason: 'notIsolated',
      });
    });
  });
});
