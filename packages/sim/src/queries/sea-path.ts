// Составной путь через море (03-cities-buildings.md, «Порты и море»): сушей до своего порта, по воде
// в другой свой порт, сушей до цели. Выбор пары портов — по сумме времени хода. Искать пути до
// каждого порта по отдельности дорого: на большой карте тысячи отрядов делают это одновременно, и
// недостижимый порт заливает поиском всю карту. Поэтому до портов идут двумя «волнами» (от начала
// и от цели), каждая останавливается, найдя несколько ближайших портов; настоящие пути строятся
// лишь для выбранной пары.
import { SEA_MOVE_S_PER_HEX, TICKS_PER_S } from '../balance.ts';
import { seaField, planSeaRoute } from './sea-route.ts';
import type { HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { isPortOf, waterNeighbors } from '../state/port.ts';
import type { MatchState } from '../state/types.ts';

/** Сколько ближайших портов учитывает каждая волна. */
const PORT_CANDIDATES = 3;

/**
 * Свои порты игрока. Порт — склад или город, поэтому гексы без зданий и городов даже не
 * проверяются: полный обход карты на каждый запрос пути был заметной тратой.
 */
export function ownPortSet(state: MatchState, owner: number): Set<HexId> {
  const ports = new Set<HexId>();
  const { building, owner: owners } = state.hexes;
  for (let h = 0; h < building.length; h += 1) {
    if (owners[h] === owner && building[h] !== 0 && isPortOf(state, owner, h)) ports.add(h);
  }
  for (const city of state.cities) {
    if (city.owner === owner && isPortOf(state, owner, city.hex)) ports.add(city.hex);
  }
  return ports;
}

/** Операции наземного поиска, которые нужны составному пути. */
export interface SeaOps {
  /** Волна от гекса: ближайшие порты и время хода до них, тики; не дальше limit. */
  flood(from: HexId, ports: ReadonlySet<HexId>, want: number, limit: number): Map<HexId, number>;
  /** Путь по суше между гексами не дольше limit тиков. */
  leg(from: HexId, to: HexId, limit: number): HexId[] | null;
}

/**
 * Составной путь по портам игрока.
 * @param limit время, дольше которого составной путь не интересен (путь по суше), тики
 * @returns гексы после from до to или null, если через море не добраться
 */
export function composeSeaPath(
  state: MatchState,
  owner: number,
  from: HexId,
  to: HexId,
  ops: SeaOps,
  limit: number,
  ports: ReadonlySet<HexId> = ownPortSet(state, owner),
): HexId[] | null {
  if (ports.size < 2) return null;
  const near = ops.flood(from, ports, PORT_CANDIDATES, limit);
  if (near.size === 0) return null;
  const far = ops.flood(to, ports, PORT_CANDIDATES, limit);
  if (far.size === 0) return null;
  const seaTick = Math.max(1, intDiv(SEA_MOVE_S_PER_HEX * TICKS_PER_S, FP));
  let best: { a: HexId; b: HexId } | null = null;
  let bestCost = limit;
  for (const [a, costA] of near) {
    const field = seaField(state.map, a);
    for (const [b, costB] of far) {
      if (a === b) continue;
      let sea = -1;
      for (const w of waterNeighbors(state.map, b)) {
        const d = field.dist[w] ?? -1;
        if (d > 0 && (sea < 0 || d < sea)) sea = d;
      }
      if (sea < 0) continue;
      const cost = costA + sea * seaTick + costB;
      if (cost < bestCost) {
        bestCost = cost;
        best = { a, b };
      }
    }
  }
  if (!best) return null;
  const legA = ops.leg(from, best.a, limit);
  const sea = planSeaRoute(state.map, best.a, best.b);
  const legB = ops.leg(best.b, to, limit);
  return legA && sea && legB ? [...legA, ...sea, ...legB] : null;
}
