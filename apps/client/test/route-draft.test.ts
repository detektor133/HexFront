import { describe, expect, it } from 'vitest';

import { createRouteDraft, type RouteView } from '../src/dev/route-draft.ts';
import { formatTravel } from '../src/dev/route-draw.ts';
import { orderHex } from '../src/dev/sandbox-selection.ts';
import { createGesture, type GestureEvent } from '../src/render/gesture.ts';

function routeSetup(ids: readonly number[] = [1]) {
  const requests: { id: number; to: number; via: readonly number[] }[] = [];
  const shown: (RouteView | null)[] = [];
  const frames: (() => void)[] = [];
  const draft = createRouteDraft({
    unitIds: () => ids,
    request: (id, _ids, to, via) => requests.push({ id, to, via }),
    show: (r) => shown.push(r),
    schedule: (run) => frames.push(run),
  });
  const frame = (): void => frames.splice(0).forEach((run) => run());
  return { draft, requests, shown, frame };
}

describe('маршрут по точкам', () => {
  it('жест: shift доходит до события tap, без него — false', () => {
    const events: GestureEvent[] = [];
    const g = createGesture(
      {
        drawing: () => false,
        press: () => {},
        release: () => {},
        canHold: () => false,
        cancelZone: () => false,
        inside: () => true,
      },
      (e) => events.push(e),
    );
    g.down(1, { x: 5, y: 5 }, 2, 0, true);
    g.up(1, { x: 5, y: 5 }, 10);
    g.down(2, { x: 5, y: 5 }, 2, 1000);
    g.up(2, { x: 5, y: 5 }, 1010);
    expect(events).toMatchObject([
      { t: 'tap', kind: 'order', shift: true },
      { t: 'tap', kind: 'order', shift: false },
    ]);
  });

  it('копит точки, take отдаёт via и очищает, подряд одинаковые отбрасываются', () => {
    const { draft } = routeSetup();
    draft.add(10);
    draft.add(10);
    draft.add(20);
    expect(draft.take()).toEqual([10, 20]);
    expect(draft.points).toEqual([]);
  });

  it('запрос подсказки раз за кадр и только при смене гекса; ответ показывает путь и точки', () => {
    const { draft, requests, shown, frame } = routeSetup();
    draft.add(10);
    draft.hover(30);
    draft.hover(31);
    frame();
    expect(requests).toEqual([{ id: 1, to: 31, via: [10] }]);
    draft.hover(31);
    frame();
    expect(requests).toHaveLength(1);
    draft.reply(1, { path: [10, 31], ticks: 125, enemyOnPath: true });
    expect(shown.at(-1)).toEqual({
      path: [10, 31],
      ticks: 125,
      enemyOnPath: true,
      waypoints: [10, 31],
    });
  });

  it('устаревший ответ игнорируется, clear (Esc) убирает подсказку без команды', () => {
    const { draft, shown, frame } = routeSetup();
    draft.add(10);
    frame();
    draft.hover(20);
    frame();
    draft.reply(1, { path: [10], ticks: 10, enemyOnPath: false });
    expect(shown).toEqual([]);
    draft.clear();
    expect(shown.at(-1)).toBeNull();
    expect(draft.points).toEqual([]);
  });

  it('время в пути м:сс по тикам', () => {
    expect(formatTravel(125)).toBe('0:13');
    expect(formatTravel(600)).toBe('1:00');
  });

  it('orderHex: via уходит в move; без via payload прежний', () => {
    const view = {
      playerId: 0,
      units: [{ id: 1, owner: 0, hex: 5, type: 'infantry' }],
      cities: [],
    } as never;
    const picked = { hex: null, units: [1], target: null };
    expect(orderHex(view, picked, 9, [7]).cmd).toEqual({
      t: 'move',
      unitIds: [1],
      to: 9,
      via: [7],
    });
    expect(orderHex(view, picked, 9).cmd).toEqual({ t: 'move', unitIds: [1], to: 9 });
  });
});
