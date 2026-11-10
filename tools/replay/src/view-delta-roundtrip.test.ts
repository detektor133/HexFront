// Предохранитель формата дельты: что бы ни добавили в PlayerView, дельта по реальному матчу обязана
// восстановить вид точно. Тест не знает полей вида, поэтому новое поле его не ломает, а ошибка
// в схеме передачи — ловит.
import { describe, expect, it } from 'vitest';

import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  applyViewDelta,
  buildViewDelta,
  canBuildViewDelta,
  decodeDelta,
  encodeDelta,
  equalValue,
  paceView,
  SLOW_PERIOD_TICKS,
} from '../../../packages/protocol/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  createPlayerViewContext,
  loadMap,
  playerView,
  step,
  type PlayerView,
} from '../../../packages/sim/src/index.ts';

const WATCHED = [0, 7];
const TICKS = 150;

/** Имена полей вида, которые разошлись (пусто — виды равны). */
function differing(left: PlayerView, right: PlayerView): string[] {
  const a = left as unknown as Record<string, unknown>;
  const b = right as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) => !equalValue(a[key], b[key]),
  );
}

describe('дельта вида восстанавливает вид по реальному матчу', () => {
  for (const fog of [true, false]) {
    it(`через JSON, туман ${fog ? 'включён' : 'выключен'}`, () => {
      const loaded = loadMap(generateMap(43, { players: 30 }));
      if ('errors' in loaded) throw new Error(loaded.errors.join('\n'));
      const bots = Array.from({ length: 30 }, (_, id) => id);
      const state = createMatch(
        loaded.map,
        bots.map((id) => ({ name: `P${id}` })),
        43,
        { fog },
      );
      const mirrors = new Map<number, PlayerView>();
      const syncedAt = new Map<number, number>();
      let deltas = 0;

      for (let tick = 0; tick < TICKS; tick += 1) {
        const context = createBotTickContext(state);
        step(state, [
          ...commanderCommands(state, bots, context),
          ...botCommands(state, bots, context),
        ]);
        const viewContext = createPlayerViewContext(state);
        for (const id of WATCHED) {
          const view = playerView(state, id, viewContext);
          const mirror = mirrors.get(id);
          if (mirror && canBuildViewDelta(mirror, view)) {
            const sync = view.tick - (syncedAt.get(id) ?? 0) >= SLOW_PERIOD_TICKS;
            const sent = paceView(mirror, view, sync);
            const wire = decodeDelta(encodeDelta(buildViewDelta(mirror, sent, [])), mirror.tick);
            const restored = applyViewDelta(mirror, wire);
            const where = `тик ${tick}, игрок ${id}`;
            // Клиент получает ровно то, что собрал сервер.
            expect(differing(restored, sent), where).toEqual([]);
            if (sync) {
              // В срок синхронизации медленные поля догоняют настоящий вид полностью.
              expect(differing(restored, view), where).toEqual([]);
              syncedAt.set(id, view.tick);
            } else {
              // Между синхронизациями отстать могут только объявленные медленные поля.
              const stale = differing(restored, view);
              expect(
                stale.filter((key) => !['hexes', 'me', 'cities', 'ranking'].includes(key)),
              ).toEqual([]);
            }
            // Зеркало живёт на восстановленных видах: расхождение копится и всплывёт на сверке.
            mirrors.set(id, restored);
            deltas += 1;
          } else {
            mirrors.set(id, view);
          }
        }
      }
      expect(deltas).toBeGreaterThan(TICKS);
    }, 120_000);
  }
});
