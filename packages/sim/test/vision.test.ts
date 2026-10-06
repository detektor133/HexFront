import { describe, expect, it } from 'vitest';

import { TICKS_PER_S, VISION_RECALC_TICKS } from '../src/balance.ts';
import { move, own, city, scenario, at } from './scenario/dsl.ts';
import { createVisionState, recalculateVision } from '../src/systems/vision.ts';

function visionSnapshot(vision: ReturnType<typeof createVisionState>): unknown {
  return {
    visible: vision.visible.map((values) => [...values]),
    explored: vision.explored.map((values) => [...values]),
    road: vision.road.map((values) => [...values]),
    improvement: vision.improvement.map((values) => [...values]),
    building: vision.building.map((values) => [...values]),
  };
}

describe('инкрементальный обзор', () => {
  it('совпадает с полным пересчётом после изменений источников обзора', () => {
    const s = scenario(
      `
      A  A  A  .  b  b  b  b
      A  A1 A  .  b  B1 b  b
      A  A  A  .  b  b  b  b
      `,
      {
        legend: {
          A: own('A'),
          A1: city('A', 1, { capital: true }),
          B1: city('B', 1, { capital: true }),
          b: own('B'),
        },
      },
    );
    const unitId = s.unit('A', 'infantry', 100, at(2, 1));
    s.runTicks(1);
    const reference = createVisionState(s.state.players.length, s.state.hexes.owner.length);

    for (let tick = 0; tick < 3000; tick += 1) {
      if (tick === 5) s.setOwner(at(3, 0), 'A');
      if (tick === 10) s.setBuilding(at(1, 0), 'fort');
      if (tick === 15) s.setOwner(at(3, 1), 'A');
      if (tick === 20) s.cmd('A', move([unitId], at(3, 1)));
      s.runTicks(1);
      if ((s.state.tick - 1) % VISION_RECALC_TICKS !== 0) continue;
      recalculateVision(s.state, reference);
      expect(s.state.vision).toBeDefined();
      expect(visionSnapshot(s.state.vision as ReturnType<typeof createVisionState>)).toEqual(
        visionSnapshot(reference),
      );
    }

    expect(s.state.tick).toBeGreaterThan(TICKS_PER_S);
  });
});
