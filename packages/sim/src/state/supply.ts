// Снабжённость отрядов одного игрока: производство сетей, потери пути, приписка к сети.
// GDD: docs/gdd/04-roads-supply.md — «Снабжение отрядов»; 02-economy.md — «Банкротство».
import {
  BANKRUPT_SUPPLY_MULT,
  CAPITAL_SUPPLY_BONUS,
  CITY_SUPPLY_PER_LEVEL,
  DEPOT_LOSS_MULT,
  DEPOT_RADIUS,
  ISOLATED_SUPPLY_MULT,
  OFFROAD_SUPPLY_LOSS,
  SUPPLY_PER_SOLDIER,
} from '../balance.ts';
import { cityOutputMult } from './city-output.ts';
import { isCityIsolated } from './network.ts';
import { BUILDING, type City, type MatchState, type SupplyNetwork, type Unit } from './types.ts';
import { TERRAIN_NAMES } from '../map/types.ts';
import { createHeap, heapPop, heapPush } from '../math/heap.ts';
import { hexFromId, hexId, inBounds, neighbors, spiral } from '../math/hex.ts';
import { FP, fpDiv, fpMul, type Fp } from '../math/int.ts';

/**
 * Снабжение, которое производит город: CITY_SUPPLY_PER_LEVEL × level (+ CAPITAL_SUPPLY_BONUS
 * у столицы) × выработка после захвата, в изолированной сети — × ISOLATED_SUPPLY_MULT.
 * @returns fixed-point единиц снабжения (1 единица кормит 1 солдата пехоты)
 */
export function citySupply(state: MatchState, city: City): Fp {
  const isCapital = state.players[city.owner]?.capitalCityId === city.id;
  const base = (CITY_SUPPLY_PER_LEVEL * city.level + (isCapital ? CAPITAL_SUPPLY_BONUS : 0)) as Fp;
  const raw = fpMul(base, cityOutputMult(city));
  return isCityIsolated(state, city.id) ? fpMul(raw, ISOLATED_SUPPLY_MULT) : raw;
}

// Потери снабжения за гекс вне дорог; в радиусе склада — × DEPOT_LOSS_MULT.
function lossMap(state: MatchState, owner: number): Int32Array {
  const { width, height, terrain } = state.map;
  const nearDepot = new Uint8Array(width * height);
  state.hexes.building.forEach((b, id) => {
    if (b !== BUILDING.depot || state.hexes.owner[id] !== owner) return;
    for (const h of spiral(hexFromId(id, width), DEPOT_RADIUS)) {
      if (inBounds(h, width, height)) nearDepot[hexId(h, width)] = 1;
    }
  });
  return Int32Array.from(terrain, (code, id) => {
    const name = TERRAIN_NAMES[code];
    if (name === undefined || name === 'water') return FP;
    const loss = OFFROAD_SUPPLY_LOSS[name];
    return nearDepot[id] === 1 ? fpMul(loss, DEPOT_LOSS_MULT) : loss;
  });
}

const UNREACHED = 0x7fffffff;

// Мультиисточниковая Дейкстра от узлов сети по своим гексам; узлы этой сети — без потерь.
function lossFrom(state: MatchState, owner: number, net: number, loss: Int32Array): Int32Array {
  const { width, height } = state.map;
  const dist = new Int32Array(width * height).fill(UNREACHED);
  const heap = createHeap();
  state.hexes.network.forEach((n, id) => {
    if (n !== net) return;
    dist[id] = 0;
    heapPush(heap, 0, id);
  });
  for (let top = heapPop(heap); top; top = heapPop(heap)) {
    const [d, hex] = top;
    // Потери ≥ 100 % дальше не нужны: снабжение там уже 0.
    if (d > (dist[hex] ?? 0) || d >= FP) continue;
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (state.hexes.owner[id] !== owner) continue;
      const nd = d + (state.hexes.network[id] === net ? 0 : (loss[id] ?? FP));
      if (nd < (dist[id] ?? 0)) {
        dist[id] = nd;
        heapPush(heap, nd, id);
      }
    }
  }
  return dist;
}

// Потери пути до отряда; на чужом гексе — через лучший соседний свой гекс плюс этот гекс.
function unitLoss(state: MatchState, u: Unit, dist: Int32Array, loss: Int32Array): number {
  if (state.hexes.owner[u.hex] === u.owner) return dist[u.hex] ?? UNREACHED;
  const { width, height } = state.map;
  let best = UNREACHED;
  for (const n of neighbors(hexFromId(u.hex, width))) {
    if (inBounds(n, width, height)) best = Math.min(best, dist[hexId(n, width)] ?? UNREACHED);
  }
  return best === UNREACHED ? UNREACHED : best + (loss[u.hex] ?? FP);
}

interface Option {
  readonly net: SupplyNetwork;
  /** Доля снабжения, дошедшая до отряда, fixed-point. */
  readonly eff: Fp;
}

// R(сеть) = min(1, P / D) при заданной приписке отрядов.
function ratios(
  state: MatchState,
  nets: readonly SupplyNetwork[],
  pick: ReadonlyMap<Unit, Option>,
): Map<number, Fp> {
  const demand = new Map<number, number>();
  for (const [u, o] of pick) {
    const d = fpMul(u.soldiers, SUPPLY_PER_SOLDIER[u.type]);
    demand.set(o.net.id, (demand.get(o.net.id) ?? 0) + d);
  }
  const result = new Map<number, Fp>();
  for (const net of nets) {
    let produced = 0;
    for (const c of state.cities) {
      if (c.owner === net.owner && state.hexes.network[c.hex] === net.id) {
        produced += citySupply(state, c);
      }
    }
    const d = demand.get(net.id) ?? 0;
    result.set(net.id, (d === 0 ? FP : Math.min(FP, fpDiv(produced as Fp, d as Fp))) as Fp);
  }
  return result;
}

// Лучший вариант по оценке score; при равенстве — основная сеть, затем меньший id.
function best(options: readonly Option[], score: (o: Option) => number): Option | undefined {
  let top: Option | undefined;
  for (const o of options) {
    if (!top) {
      top = o;
      continue;
    }
    const a = score(o);
    const b = score(top);
    if (a > b || (a === b && o.net.isMain && !top.net.isMain)) top = o;
  }
  return top;
}

/**
 * Пересчитывает supplyLevel и признак котла у отрядов игрока:
 * supplyLevel = R(сеть) × eff, eff = max(0, 1 − потери пути), при банкротстве — × 0,5.
 * Отряд приписывается к сети с наибольшим supplyLevel: сначала по eff, затем по R × eff.
 */
export function recomputeSupply(state: MatchState, owner: number): void {
  const nets = state.networks.filter((n) => n.owner === owner);
  const units = state.units.filter((u) => u.owner === owner);
  const loss = lossMap(state, owner);
  const dists = nets.map((n) => lossFrom(state, owner, n.id, loss));
  const options = new Map<Unit, Option[]>();
  for (const u of units) {
    const list: Option[] = [];
    nets.forEach((net, i) => {
      const d = unitLoss(state, u, dists[i] ?? new Int32Array(), loss);
      if (d !== UNREACHED) list.push({ net, eff: Math.max(0, FP - d) as Fp });
    });
    options.set(u, list);
  }
  const first = new Map<Unit, Option>();
  for (const [u, list] of options) {
    const o = best(list, (x) => x.eff);
    if (o) first.set(u, o);
  }
  const r1 = ratios(state, nets, first);
  const final = new Map<Unit, Option>();
  for (const [u, list] of options) {
    const o = best(list, (x) => fpMul(r1.get(x.net.id) ?? (FP as Fp), x.eff));
    if (o) final.set(u, o);
  }
  const r2 = ratios(state, nets, final);
  const bankrupt = state.players[owner]?.bankrupt === true;
  for (const u of units) {
    const o = final.get(u);
    u.encircled = o === undefined;
    const level = o ? fpMul(r2.get(o.net.id) ?? (FP as Fp), o.eff) : 0;
    u.supplyLevel = bankrupt ? fpMul(level as Fp, BANKRUPT_SUPPLY_MULT) : (level as Fp);
  }
}

/**
 * Доля снабжения, которая дошла бы до своего гекса от лучшей сети игрока, без учёта нагрузки сети
 * (для выбора гекса отступления, 06-combat.md, «Отступление»).
 * @returns fixed-point доля 0..1
 */
export function hexSupplyEff(state: MatchState, owner: number, hex: number): Fp {
  const loss = lossMap(state, owner);
  let best = 0;
  for (const net of state.networks) {
    if (net.owner !== owner) continue;
    const d = lossFrom(state, owner, net.id, loss)[hex] ?? UNREACHED;
    if (d !== UNREACHED) best = Math.max(best, FP - d);
  }
  return best as Fp;
}
