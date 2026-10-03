// Деление вытягиванием из фишки (05-armies.md, «Разделение и слияние», CR-005): зажал свою фишку и
// повёл — вокруг неё кольцо «сколько взять». Прямо наружу — половина; поворот пальца по кольцу —
// больше (по часовой) или меньше, шагом 50 солдат. Отпустил в другом гексе — отделённая часть
// сразу идёт туда; отпустил на кольце — просто разделил.
import { FP, hexId, inBounds, TERRAIN, type Command, type Fp, type UnitView } from '@hexfront/sim';

import type { DraftContext } from './plan-draft.ts';
import { pixelToHex, type Point } from '../render/hex-geometry.ts';
import type { StrokeHandler } from '../render/map-view.ts';

/** Шаг и минимум отделяемой части — как шаг набора (05-armies.md, `FRONT_SPLIT_MIN`). */
const STEP = 50;
/** Кольцо вокруг фишки: радиус (доля радиуса гекса) и граница «ушёл в соседний гекс». */
const RING = 0.95;
const LEAVE = 1.35;
/** Поворот пальца, после которого кольцо начинает менять количество, рад. */
const DIAL_START = 0.2;

/** Что рисовать поверх карты во время вытягивания. */
export interface SplitOverlay {
  readonly center: Point;
  readonly ring: number;
  /** Доля, которую забираем (0..1), и число солдат. */
  readonly share: number;
  readonly amount: number;
  readonly target: number | null;
}

export interface SplitDeps {
  context(): DraftContext | null;
  /** Где на карте стоит фишка гекса (центр, с учётом сдвига под городом). */
  chipAt(hex: number): Point;
  send(cmd: Command): void;
  setOverlay(o: SplitOverlay | null): void;
}

const TAU = Math.PI * 2;
const angleOf = (dx: number, dy: number): number => (Math.atan2(dx, -dy) + TAU) % TAU;

// Самый большой свой отряд гекса, который можно разделить (обе части не меньше STEP).
function splittable(units: readonly UnitView[], me: number, hex: number): UnitView | null {
  let best: UnitView | null = null;
  for (const u of units) {
    if (u.owner !== me || u.hex !== hex || u.order === 'retreat' || u.moveTotal > 0) continue;
    if (u.soldiers < 2 * STEP * FP) continue;
    if (!best || u.soldiers > best.soldiers) best = u;
  }
  return best;
}

/** Захват фишки для деления: обработчик росчерка или null (под пальцем нечего делить). */
export function createSplitGrab(deps: SplitDeps): (world: Point) => StrokeHandler | null {
  return (world) => {
    const c = deps.context();
    if (!c) return null;
    const h = pixelToHex(world, c.radius);
    if (!inBounds(h, c.map.width, c.map.height)) return null;
    const hex = hexId(h, c.map.width);
    const center = deps.chipAt(hex);
    const ring = c.radius * RING;
    if (Math.hypot(world.x - center.x, world.y - center.y) > ring * 0.7) return null;
    const unit = splittable(c.view.units, c.view.playerId, hex);
    if (!unit) return null;
    const total = Math.floor(unit.soldiers / FP);
    let share = 0.5;
    let entry: number | null = null;
    let dial = false;
    let overlay: SplitOverlay | null = null;
    const amountOf = (s: number): number =>
      Math.max(STEP, Math.min(total - STEP, Math.round((s * total) / STEP) * STEP));
    return (w, phase) => {
      if (phase === 'cancel') return deps.setOverlay(null);
      const dx = w.x - center.x;
      const dy = w.y - center.y;
      const dist = Math.hypot(dx, dy);
      let target: number | null = null;
      if (dist <= ring * LEAVE) {
        const a = angleOf(dx, dy);
        if (dist >= ring * 0.5) {
          entry ??= a;
          // Поворот относительно точки входа в кольцо: по часовой — больше, против — меньше.
          const turn = ((a - entry + Math.PI * 3) % TAU) - Math.PI;
          if (Math.abs(turn) > DIAL_START) dial = true;
          if (dial) share = Math.max(0.01, Math.min(0.99, 0.5 + turn / TAU));
        }
      } else {
        const t = pixelToHex(w, c.radius);
        const id = inBounds(t, c.map.width, c.map.height) ? hexId(t, c.map.width) : -1;
        target = id >= 0 && id !== hex && c.map.terrain[id] !== TERRAIN.water ? id : null;
      }
      const amount = amountOf(share);
      overlay = { center, ring, share: amount / total, amount, target };
      if (phase !== 'end') return deps.setOverlay(overlay);
      deps.setOverlay(null);
      const cmd: Command = {
        t: 'split',
        unitId: unit.id,
        soldiers: (amount * FP) as Fp,
        ...(target === null ? {} : { to: target }),
      };
      deps.send(cmd);
    };
  };
}
