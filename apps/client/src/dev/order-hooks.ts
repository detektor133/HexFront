// Приказ удержанием и прогноз при наведении (07-controls.md, «Приказ удержанием», 04/T16):
// удержание — цель и прогноз, ведёшь — цель переезжает, отпустил — приказ «идти» или «атаковать»;
// отмена — палец на фишку выбранных отрядов (остальные отмены — в машине жестов). На ПК наведение
// на вражеский гекс при выбранных отрядах — прогноз.
import { forecastBattle, hexId, inBounds, type MapStatic, type PlayerView } from '@hexfront/sim';

import type { MarkerAnchor } from './battle-panel.ts';
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
  setPlanHover?(world: Point | null): void;
  /** Приказ выбранным отрядам в гекс (orderHex + отправка). */
  order(hex: number): void;
  /** Курсор над гексом: подсказка маршрута (черновик или путь до курсора). */
  routeHover?(hex: number | null): void;
  /** Маркер боя под мировой точкой (null — мимо). */
  markerAt?(world: Point): MarkerAnchor | null;
  setBattlePanel?(m: MarkerAnchor | null): void;
  /**
   * Удержание без выбранных отрядов (палец): меню страны под пальцем или обычный выбор.
   * screen — точка в координатах холста.
   */
  holdWithoutUnits?(world: Point, screen: Point): void;
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
    // Без выбранных отрядов удержание открывает меню страны (ПКМ на ПК); с отрядами — приказ.
    canHold: () => !d.tool() && (d.picked().units.length > 0 || d.holdWithoutUnits !== undefined),
    cancelZone(world) {
      const view = d.view();
      if (!view) return false;
      return pickedOwn(view, d.picked()).some((u) => {
        const c = d.chipAt(u.hex);
        return Math.hypot(world.x - c.x, world.y - c.y) <= d.radius * CHIP_HIT;
      });
    },
    hold(world, phase, screen) {
      if (d.picked().units.length === 0) {
        if (phase === 'end' && screen) d.holdWithoutUnits?.(world, screen);
        return;
      }
      const hex = hexAt(world);
      if (phase === 'start' || phase === 'move') {
        d.setPlanHover?.(world);
        return show(hex, false);
      }
      d.setPlanHover?.(null);
      show(null, false);
      if (phase === 'end' && hex !== null) d.order(hex);
    },
    cancel() {
      show(null, false);
      d.setPlanHover?.(null);
    },
    hover(world) {
      d.setPlanHover?.(world);
      // Панель боя точнее прогноза по гексу под ней: пока она открыта, плашка прогноза скрыта.
      const marker = world ? (d.markerAt?.(world) ?? null) : null;
      d.setBattlePanel?.(marker);
      const busy = d.tool() || d.picked().units.length === 0;
      const hex = world && !busy && !marker ? hexAt(world) : null;
      show(hex, true);
    },
  };
}
