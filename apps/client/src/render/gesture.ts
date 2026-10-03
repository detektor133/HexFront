// Жесты карты (07-controls.md, «Ручные приказы и жесты», «Приказ удержанием»): чистая машина
// состояний без DOM — тап, перетаскивание карты, росчерк (инструмент, ручка, деление), приказ
// удержанием, щипок, наведение мыши. Время — мс от любого начала отсчёта.
import type { Point } from './hex-geometry.ts';

/** Сдвиг указателя, после которого нажатие — перетаскивание, а не тап или удержание, px. */
export const DRAG_SLOP_PX = 8;
/** Удержание без сдвига дольше этого — цель приказа и прогноз, мс. */
export const HOLD_MS = 350;
const RIGHT_BUTTON = 2;

/** Фаза росчерка: палец/ЛКМ ведёт линию или тянет объект. */
export type StrokePhase = 'start' | 'move' | 'end' | 'cancel';

/** Тап выбирает; ПКМ — приказ сразу (07-controls.md, как в HoI4). */
export type TapKind = 'select' | 'order';

export type GestureEvent =
  | { readonly t: 'tap'; readonly at: Point; readonly kind: TapKind }
  | { readonly t: 'pan'; readonly dx: number; readonly dy: number }
  | {
      readonly t: 'selection';
      readonly at: Point;
      readonly to: Point;
      readonly phase: StrokePhase;
    }
  | { readonly t: 'zoom'; readonly factor: number; readonly at: Point }
  | { readonly t: 'stroke'; readonly at: Point; readonly phase: StrokePhase }
  | {
      readonly t: 'hold';
      readonly at: Point;
      readonly phase: 'start' | 'move' | 'end' | 'cancel';
    }
  | { readonly t: 'hover'; readonly at: Point | null };

export interface GestureDeps {
  /** Сейчас рисуется росчерк: включён инструмент или под пальцем захвачен объект. */
  drawing(): boolean;
  /** Нажатие одним указателем: что под ним можно тянуть (ручку фронта, свою фишку). */
  press(at: Point): void;
  /** Нажатие кончилось без захвата. */
  release(): void;
  /** Удержание — приказ: выбраны отряды и инструмент не включён. */
  canHold(): boolean;
  /** Точка на фишке выбранных отрядов — палец, вернувшийся туда, отменяет приказ. */
  cancelZone(at: Point): boolean;
  /** Точка на экране (за краем — отмена приказа). */
  inside(at: Point): boolean;
}

export interface Gesture {
  down(id: number, at: Point, button: number, ms: number, shift?: boolean): void;
  move(id: number, at: Point, ms: number): void;
  up(id: number, at: Point, ms: number): void;
  /** Отменяет активный жест без выполнения действия. */
  cancel(): void;
  /** Проверка удержания без событий указателя (таймер). */
  tick(ms: number): void;
  /** Мышь движется без нажатия; null — ушла с карты. */
  hover(at: Point | null): void;
}

type Mode =
  'idle' | 'pressed' | 'panning' | 'stroking' | 'selecting' | 'holding' | 'held' | 'multi';

/** Создаёт машину жестов; события уходят в emit в порядке возникновения. */
export function createGesture(deps: GestureDeps, emit: (e: GestureEvent) => void): Gesture {
  const active = new Map<number, Point>();
  let mode: Mode = 'idle';
  let start: Point = { x: 0, y: 0 };
  let last: Point = { x: 0, y: 0 };
  let downMs = 0;
  let button = 0;
  let shift = false;
  // Приказ удержанием: палец уходил с фишки выбранных отрядов (возврат на неё — отмена).
  let leftZone = false;

  const pinch = (): { mid: Point; dist: number } | null => {
    const [a, b] = [...active.values()];
    if (!a || !b) return null;
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  const cancelHold = (): void => {
    emit({ t: 'hold', at: last, phase: 'cancel' });
    mode = 'held';
  };

  return {
    down(id, at, btn, ms, withShift = false) {
      active.set(id, at);
      if (active.size > 1) {
        // Второй палец — всегда карта: росчерк, деление и приказ удержанием отменяются.
        if (mode === 'stroking') emit({ t: 'stroke', at: last, phase: 'cancel' });
        if (mode === 'selecting') emit({ t: 'selection', at: start, to: last, phase: 'cancel' });
        if (mode === 'holding') emit({ t: 'hold', at: last, phase: 'cancel' });
        if (mode === 'pressed') deps.release();
        mode = 'multi';
        return;
      }
      mode = 'pressed';
      start = at;
      last = at;
      downMs = ms;
      button = btn;
      shift = withShift && btn === 0;
      leftZone = false;
      if (btn === 0 && !shift) deps.press(at);
    },

    move(id, at, ms) {
      const prev = active.get(id);
      if (!prev) return;
      const before = pinch();
      active.set(id, at);
      if (mode === 'multi') {
        const after = pinch();
        if (before && after) {
          emit({ t: 'zoom', factor: after.dist / before.dist, at: after.mid });
          emit({ t: 'pan', dx: after.mid.x - before.mid.x, dy: after.mid.y - before.mid.y });
        }
        return;
      }
      last = at;
      if (mode === 'pressed') this.tick(ms);
      if (mode === 'holding') {
        if (!deps.inside(at)) return cancelHold();
        const inZone = deps.cancelZone(at);
        if (inZone && leftZone) return cancelHold();
        if (!inZone) leftZone = true;
        emit({ t: 'hold', at, phase: 'move' });
        return;
      }
      if (mode === 'held') return;
      if (mode === 'pressed') {
        if (Math.hypot(at.x - start.x, at.y - start.y) <= DRAG_SLOP_PX) return;
        if (shift) {
          mode = 'selecting';
          deps.release();
          emit({ t: 'selection', at: start, to: at, phase: 'start' });
        } else if (button === 0 && deps.drawing()) {
          mode = 'stroking';
          emit({ t: 'stroke', at: start, phase: 'start' });
        } else {
          mode = 'panning';
          deps.release();
          emit({ t: 'pan', dx: at.x - start.x, dy: at.y - start.y });
          return;
        }
      }
      if (mode === 'stroking') emit({ t: 'stroke', at, phase: 'move' });
      else if (mode === 'selecting') emit({ t: 'selection', at: start, to: at, phase: 'move' });
      else if (mode === 'panning') emit({ t: 'pan', dx: at.x - prev.x, dy: at.y - prev.y });
    },

    up(id, at, ms) {
      if (!active.has(id)) return;
      active.delete(id);
      if (mode === 'pressed') this.tick(ms);
      if (mode === 'stroking') emit({ t: 'stroke', at, phase: 'end' });
      else if (mode === 'selecting') emit({ t: 'selection', at: start, to: at, phase: 'end' });
      else if (mode === 'holding') emit({ t: 'hold', at: last, phase: 'end' });
      else if (mode === 'pressed') {
        deps.release();
        emit({ t: 'tap', at, kind: button === RIGHT_BUTTON ? 'order' : 'select' });
      }
      if (active.size === 0) mode = 'idle';
    },

    cancel() {
      if (mode === 'stroking') emit({ t: 'stroke', at: last, phase: 'cancel' });
      if (mode === 'selecting') emit({ t: 'selection', at: start, to: last, phase: 'cancel' });
      if (mode === 'holding') emit({ t: 'hold', at: last, phase: 'cancel' });
      if (mode === 'pressed') deps.release();
      active.clear();
      mode = 'idle';
    },

    tick(ms) {
      if (mode !== 'pressed' || button !== 0 || ms - downMs < HOLD_MS) return;
      if (!deps.canHold()) return;
      // Удержание побеждает захват: приказ, а не деление.
      deps.release();
      mode = 'holding';
      leftZone = !deps.cancelZone(start);
      emit({ t: 'hold', at: start, phase: 'start' });
    },

    hover(at) {
      if (active.size === 0) emit({ t: 'hover', at });
    },
  };
}
