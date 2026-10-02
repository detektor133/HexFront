// Приказ удержанием и прогноз при наведении (07-controls.md, «Приказ удержанием», 04/T16):
// удержание — цель и прогноз, ведёшь — цель переезжает, отпустил — приказ «идти» или «атаковать»;
// отмена — палец на фишку выбранных отрядов (остальные отмены — в машине жестов). На ПК наведение
// на вражеский гекс при выбранных отрядах — прогноз.
import { forecastBattle, hexId, inBounds, type MapStatic, type PlayerView } from '@hexfront/sim';

import type { OrderTarget } from './economy-layer.ts';
import { forecastBadge } from './forecast-plate.ts';
import { isHostile, pickedOwn, type Picked } from './sandbox-selection.ts';
import { pixelToHex, type Point } from '../render/hex-geometry.ts';
import type { OrderHooks } from '../render/map-view.ts';

/** Фишка выбранных отрядов под пальцем — в пределах этой доли радиуса гекса от её центра. */
const CHIP_HIT = 0.5;

export interface OrderDeps {
  readonly map: MapStatic;
  readonly radius: number;
  view(): PlayerView | null;
  picked(): Picked;
  /** Включён инструмент планов — удержание не приказ. */
  tool(): boolean;
  chipAt(hex: number): Point;
  setTarget(t: OrderTarget | null): void;
  /** Приказ выбранным отрядам в гекс (orderHex + отправка). */
  order(hex: number): void;
}

/** Хуки карты для приказа удержанием и наведения. */
export function createOrderHooks(d: OrderDeps): OrderHooks {
  const hexAt = (world: Point): number | null => {
    const h = pixelToHex(world, d.radius);
    return inBounds(h, d.map.width, d.map.height) ? hexId(h, d.map.width) : null;
  };
  // Цель и прогноз, если там враг (атакует пехота и броня — как в orderHex).
  const target = (view: PlayerView, hex: number): OrderTarget => {
    if (!isHostile(view, hex)) return { hex, badge: null };
    const ids = pickedOwn(view, d.picked())
      .filter((u) => u.type !== 'artillery')
      .map((u) => u.id);
    return {
      hex,
      badge: ids.length > 0 ? forecastBadge(forecastBattle(d.map, view, ids, hex)) : null,
    };
  };
  let shown: number | null = null;
  const show = (hex: number | null, hostileOnly: boolean): void => {
    const view = d.view();
    if (hex === shown) return;
    shown = hex;
    if (!view || hex === null) return d.setTarget(null);
    const t = target(view, hex);
    d.setTarget(hostileOnly && !t.badge ? null : t);
  };
  return {
    canHold: () => !d.tool() && d.picked().units.length > 0,
    cancelZone(world) {
      const view = d.view();
      if (!view) return false;
      return pickedOwn(view, d.picked()).some((u) => {
        const c = d.chipAt(u.hex);
        return Math.hypot(world.x - c.x, world.y - c.y) <= d.radius * CHIP_HIT;
      });
    },
    hold(world, phase) {
      const hex = hexAt(world);
      if (phase === 'start' || phase === 'move') return show(hex, false);
      show(null, false);
      if (phase === 'end' && hex !== null) d.order(hex);
    },
    cancel() {
      show(null, false);
    },
    hover(world) {
      const busy = d.tool() || d.picked().units.length === 0;
      show(world && !busy ? hexAt(world) : null, true);
    },
  };
}
