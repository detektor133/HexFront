import { describe, expect, it, vi } from 'vitest';

import {
  battleOrgState,
  createBattleMarker,
  getBattleForecastPresentation,
} from '../src/match/battle-marker.ts';

describe('маркер боя и плашка прогноза (07/T12a)', () => {
  it('4: переводит долю организованности в одно из 8 состояний на границах 0, 12,5, 50 и 100 % и для равных сторон', () => {
    expect(battleOrgState(0, 100)).toBe(0);
    expect(battleOrgState(1, 7)).toBe(1);
    expect(battleOrgState(50, 50)).toBe(4);
    expect(battleOrgState(100, 0)).toBe(7);
    expect(battleOrgState(40, 40)).toBe(4);
    expect(battleOrgState(null, null)).toBeNull();
  });

  it('4: при неизменном состоянии маркер не создаёт новых объектов Pixi', () => {
    const createStateObject = vi.fn(() => ({ state: 4 }));
    const marker = createBattleMarker({ createStateObject });

    marker.update(4);
    const firstObject = marker.object;
    marker.update(4);

    expect(createStateObject).toHaveBeenCalledTimes(1);
    expect(marker.object).toBe(firstObject);
  });

  it('4: на карте без наведения есть иконка исхода, но нет карточки плашки', () => {
    expect(getBattleForecastPresentation({ hovered: false, outcome: 'success' })).toEqual({
      showOutcomeIcon: true,
      showForecastCard: false,
    });
  });
});
