import { describe, expect, it } from 'vitest';

import {
  DRAG_SLOP_PX,
  HOLD_MS,
  createGesture,
  type GestureDeps,
  type GestureEvent,
} from '../src/render/gesture.ts';

type Pt = { x: number; y: number };

interface Setup {
  readonly events: GestureEvent[];
  readonly g: ReturnType<typeof createGesture>;
  readonly state: { drawing: boolean; canHold: boolean; zone: (p: Pt) => boolean };
}

function setup(over: Partial<Setup['state']> = {}): Setup {
  const events: GestureEvent[] = [];
  const state = { drawing: false, canHold: true, zone: (_: Pt) => false, ...over };
  const deps: GestureDeps = {
    drawing: () => state.drawing,
    press: () => undefined,
    release: () => undefined,
    canHold: () => state.canHold,
    cancelZone: (p) => state.zone(p),
    inside: (p) => p.x >= 0 && p.y >= 0 && p.x <= 1000 && p.y <= 800,
  };
  return { events, g: createGesture(deps, (e) => events.push(e)), state };
}

const kinds = (s: Setup): string[] =>
  s.events.map((e) => (e.t === 'tap' ? `tap:${e.kind}` : 'phase' in e ? `${e.t}:${e.phase}` : e.t));

describe('жесты карты (04/T16, 07-controls.md)', () => {
  it('выдаёт рамку выбора только для Shift + ЛКМ', () => {
    const s = setup();
    s.g.down(1, { x: 10, y: 20 }, 0, 0, true);
    s.g.move(1, { x: 30, y: 50 }, 20);
    s.g.up(1, { x: 40, y: 60 }, 40);
    expect(s.events).toEqual([
      { t: 'selection', at: { x: 10, y: 20 }, to: { x: 30, y: 50 }, phase: 'start' },
      { t: 'selection', at: { x: 10, y: 20 }, to: { x: 30, y: 50 }, phase: 'move' },
      { t: 'selection', at: { x: 10, y: 20 }, to: { x: 40, y: 60 }, phase: 'end' },
    ]);
  });

  it('не превращает обычное перетаскивание в рамку выбора', () => {
    const s = setup();
    s.g.down(1, { x: 10, y: 20 }, 0, 0);
    s.g.move(1, { x: 30, y: 50 }, 20);
    expect(s.events.some((event) => event.t === 'selection')).toBe(false);
    expect(s.events[0]?.t).toBe('pan');
  });

  it('пороги: сдвиг ≤ 8 px — тап, больше — карта; удержание — 350 мс', () => {
    expect(DRAG_SLOP_PX).toBe(8);
    expect(HOLD_MS).toBe(350);
    const a = setup();
    a.g.down(1, { x: 100, y: 100 }, 0, 0);
    a.g.move(1, { x: 107, y: 100 }, 50);
    a.g.up(1, { x: 107, y: 100 }, 100);
    expect(kinds(a)).toEqual(['tap:select']);
    const b = setup();
    b.g.down(1, { x: 100, y: 100 }, 0, 0);
    b.g.move(1, { x: 109, y: 100 }, 50);
    b.g.up(1, { x: 109, y: 100 }, 100);
    expect(kinds(b)).toContain('pan');
    expect(kinds(b)).not.toContain('tap:select');
  });

  it('удержание → ведение → отпускание: цель и приказ в точке под пальцем', () => {
    const s = setup();
    s.g.down(1, { x: 100, y: 100 }, 0, 0);
    s.g.tick(HOLD_MS - 10);
    expect(s.events).toEqual([]);
    s.g.tick(HOLD_MS);
    s.g.move(1, { x: 200, y: 150 }, HOLD_MS + 100);
    s.g.up(1, { x: 200, y: 150 }, HOLD_MS + 200);
    expect(kinds(s)).toEqual(['hold:start', 'hold:move', 'hold:end']);
    expect(s.events.at(-1)).toMatchObject({ t: 'hold', phase: 'end', at: { x: 200, y: 150 } });
    // Ведение пальца при удержании не двигает карту.
    expect(kinds(s)).not.toContain('pan');
  });

  it('сдвиг больше 8 px до 350 мс — не приказ: карта (или деление со своей фишки)', () => {
    const map = setup();
    map.g.down(1, { x: 100, y: 100 }, 0, 0);
    map.g.move(1, { x: 120, y: 100 }, 100);
    map.g.tick(HOLD_MS + 50);
    map.g.up(1, { x: 120, y: 100 }, HOLD_MS + 100);
    expect(kinds(map)).not.toContain('hold:start');
    const split = setup({ drawing: true });
    split.g.down(1, { x: 100, y: 100 }, 0, 0);
    split.g.move(1, { x: 120, y: 100 }, 100);
    split.g.up(1, { x: 120, y: 100 }, 200);
    expect(kinds(split)).toEqual(['stroke:start', 'stroke:move', 'stroke:end']);
  });

  it('каждая из трёх отмен не отдаёт приказа', () => {
    // 1. Палец вернулся на фишку выбранных отрядов.
    const chip = setup({ zone: (p) => p.x < 110 });
    chip.g.down(1, { x: 100, y: 100 }, 0, 0);
    chip.g.tick(HOLD_MS);
    chip.g.move(1, { x: 200, y: 100 }, 400);
    chip.g.move(1, { x: 105, y: 100 }, 500);
    chip.g.up(1, { x: 105, y: 100 }, 600);
    expect(kinds(chip)).toEqual(['hold:start', 'hold:move', 'hold:cancel']);
    // 2. Палец ушёл за край экрана.
    const edge = setup();
    edge.g.down(1, { x: 100, y: 100 }, 0, 0);
    edge.g.tick(HOLD_MS);
    edge.g.move(1, { x: -5, y: 100 }, 400);
    edge.g.up(1, { x: 50, y: 100 }, 500);
    expect(kinds(edge)).toEqual(['hold:start', 'hold:cancel']);
    // 3. Второй палец.
    const two = setup();
    two.g.down(1, { x: 100, y: 100 }, 0, 0);
    two.g.tick(HOLD_MS);
    two.g.down(2, { x: 300, y: 300 }, 0, 400);
    two.g.up(2, { x: 300, y: 300 }, 500);
    two.g.up(1, { x: 100, y: 100 }, 600);
    expect(kinds(two).slice(0, 2)).toEqual(['hold:start', 'hold:cancel']);
    expect(kinds(two)).not.toContain('hold:end');
    expect(kinds(two)).not.toContain('tap:order');
  });

  it('второй палец отменяет росчерк и деление', () => {
    const s = setup({ drawing: true });
    s.g.down(1, { x: 100, y: 100 }, 0, 0);
    s.g.move(1, { x: 130, y: 100 }, 100);
    s.g.down(2, { x: 300, y: 300 }, 0, 150);
    s.g.up(1, { x: 130, y: 100 }, 200);
    s.g.up(2, { x: 300, y: 300 }, 250);
    expect(kinds(s)).toEqual(['stroke:start', 'stroke:move', 'stroke:cancel']);
  });

  it('ПКМ — приказ сразу; ПКМ-перетаскивание — карта', () => {
    const click = setup();
    click.g.down(1, { x: 100, y: 100 }, 2, 0);
    click.g.up(1, { x: 101, y: 100 }, 50);
    expect(kinds(click)).toEqual(['tap:order']);
    const drag = setup();
    drag.g.down(1, { x: 100, y: 100 }, 2, 0);
    drag.g.move(1, { x: 150, y: 100 }, 50);
    drag.g.up(1, { x: 150, y: 100 }, 100);
    expect(kinds(drag)).toContain('pan');
    expect(kinds(drag)).not.toContain('tap:order');
  });

  it('без выбранных отрядов удержание — обычный тап выбора', () => {
    const s = setup({ canHold: false });
    s.g.down(1, { x: 100, y: 100 }, 0, 0);
    s.g.tick(HOLD_MS + 100);
    s.g.up(1, { x: 100, y: 100 }, HOLD_MS + 200);
    expect(kinds(s)).toEqual(['tap:select']);
  });

  it('наведение мышью без нажатия — событие наведения (для прогноза на ПК)', () => {
    const s = setup();
    s.g.hover({ x: 10, y: 20 });
    expect(s.events).toEqual([{ t: 'hover', at: { x: 10, y: 20 } }]);
  });
});
