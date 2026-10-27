import { describe, expect, it } from 'vitest';

import {
  DRAG_SLOP_PX,
  createGesture,
  type GestureDeps,
  type GestureEvent,
} from '../src/render/gesture.ts';

type HitObject = 'own-chip' | 'front-handle' | null;

function makeGesture(
  options: {
    readonly toolActive?: boolean;
    readonly hitTest?: (at: { readonly x: number; readonly y: number }) => HitObject;
  } = {},
): {
  readonly events: GestureEvent[];
  readonly gesture: ReturnType<typeof createGesture>;
  readonly getCaptured: () => HitObject;
} {
  const events: GestureEvent[] = [];
  let captured: HitObject = null;
  const deps: GestureDeps = {
    drawing: () => options.toolActive === true || captured !== null,
    press: (at) => {
      captured = options.hitTest?.(at) ?? null;
    },
    release: () => {
      captured = null;
    },
    canHold: () => false,
    cancelZone: () => false,
    inside: () => true,
  };
  return {
    events,
    gesture: createGesture(deps, (event) => events.push(event)),
    getCaptured: () => captured,
  };
}

describe('07/T17az — рамка выбора отрядов ЛКМ', () => {
  it('Приёмка 1: ЛКМ без Shift начинает рамку только после превышения DRAG_SLOP_PX', () => {
    const belowThreshold = makeGesture();
    belowThreshold.gesture.down(1, { x: 10, y: 10 }, 0, 0);
    belowThreshold.gesture.move(1, { x: 10 + DRAG_SLOP_PX, y: 10 }, 10);
    expect(belowThreshold.events.some((event) => event.t === 'selection')).toBe(false);

    const selection = makeGesture();
    selection.gesture.down(1, { x: 10, y: 10 }, 0, 0);
    selection.gesture.move(1, { x: 11 + DRAG_SLOP_PX, y: 10 }, 10);
    expect(selection.events).toContainEqual({
      t: 'selection',
      at: { x: 10, y: 10 },
      to: { x: 11 + DRAG_SLOP_PX, y: 10 },
      phase: 'start',
    });
  });

  it('Приёмка 1: активный инструмент сохраняет приоритет и начинает росчерк', () => {
    const stroke = makeGesture({ toolActive: true });
    stroke.gesture.down(1, { x: 10, y: 10 }, 0, 0);
    stroke.gesture.move(1, { x: 30, y: 10 }, 10);
    stroke.gesture.up(1, { x: 30, y: 10 }, 20);
    expect(stroke.events.map((event) => event.t)).toEqual(['stroke', 'stroke', 'stroke']);
  });

  it('Приёмка 1: hit-test своей фишки захватывает её и сохраняет приоритет вытягивания', () => {
    const chip = makeGesture({
      hitTest: (at) => (at.x === 10 ? 'own-chip' : null),
    });
    chip.gesture.down(1, { x: 10, y: 10 }, 0, 0);
    expect(chip.getCaptured()).toBe('own-chip');
    chip.gesture.move(1, { x: 30, y: 10 }, 10);
    chip.gesture.up(1, { x: 30, y: 10 }, 20);
    expect(chip.events.map((event) => event.t)).toEqual(['stroke', 'stroke', 'stroke']);
  });

  it('Приёмка 1: hit-test ручки фронта захватывает её и сохраняет приоритет перетаскивания', () => {
    const handle = makeGesture({
      hitTest: (at) => (at.x === 20 ? 'front-handle' : null),
    });
    handle.gesture.down(1, { x: 20, y: 10 }, 0, 0);
    expect(handle.getCaptured()).toBe('front-handle');
    handle.gesture.move(1, { x: 40, y: 10 }, 10);
    handle.gesture.up(1, { x: 40, y: 10 }, 20);
    expect(handle.events.map((event) => event.t)).toEqual(['stroke', 'stroke', 'stroke']);
  });

  it('Приёмка 1: без захвата объекта карта переходит в рамку выбора', () => {
    const selection = makeGesture({ hitTest: () => null });
    selection.gesture.down(1, { x: 30, y: 10 }, 0, 0);
    expect(selection.getCaptured()).toBeNull();
    selection.gesture.move(1, { x: 50, y: 10 }, 10);
    expect(selection.events.some((event) => event.t === 'selection')).toBe(true);
  });

  it('Приёмка 1: два пальца сохраняют панорамирование и зум', () => {
    const pinch = makeGesture();
    pinch.gesture.down(1, { x: 0, y: 0 }, 0, 0, false, false);
    pinch.gesture.down(2, { x: 20, y: 0 }, 0, 0, false, false);
    pinch.gesture.move(2, { x: 40, y: 0 }, 10);
    expect(pinch.events).toContainEqual({ t: 'zoom', factor: 2, at: { x: 20, y: 0 } });
  });
});
