import { describe, expect, it } from 'vitest';

import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
} from '../../src/index.ts';

const TICKS = 3000;

describe('непрерывность движения', () => {
  it('идущий отряд не откатывается: прогресс шага падает только при приходе или остановке', () => {
    const loaded = loadMap(small);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const state = createMatch(
      loaded.map,
      Array.from({ length: 4 }, (_, id) => ({ name: `P${id}` })),
      7,
    );
    const bots = state.players.map((player) => player.id);
    let rollbacks = 0;
    for (let tick = 0; tick < TICKS; tick += 1) {
      const before = new Map(
        state.units.map((u) => [
          u.id,
          { hex: u.hex, ticks: u.moveTicks, total: u.moveTotal, order: u.order },
        ]),
      );
      const context = createBotTickContext(state);
      step(state, [
        ...commanderCommands(state, bots, context),
        ...botCommands(state, bots, context),
      ]);
      for (const u of state.units) {
        const was = before.get(u.id);
        if (!was || was.order !== 'move' || was.total === 0) continue;
        // Откат: тот же гекс, тот же приказ «идти», а накопленный прогресс шага обнулился.
        if (u.hex === was.hex && u.order === 'move' && u.moveTicks < was.ticks) rollbacks += 1;
      }
    }
    // Остаток — редкие встречи с врагом на гексе впереди (шаг сбрасывается в бой): раньше было ~1200.
    expect(rollbacks).toBeLessThan(30);
  }, 120_000);
});
