// Доход игроков: налог с населения, города, шахты; изолированные сети — ×0,5. Содержание отрядов
// и банкротство. GDD: docs/gdd/02-economy.md — «Золото», «Банкротство»; 04-roads-supply.md.
import {
  CAPITAL_CHAOS_INCOME_MULT,
  GOLD_PER_POP_TAX,
  ISOLATED_INCOME_MULT,
  MINE_GOLD_PER_S,
  TICKS_PER_S,
  UPKEEP_GOLD_PER_UNIT_S,
  UPKEEP_GOLD_PER_SOLDIER_S,
} from '../balance.ts';
import { cityCoverage } from './city-coverage.ts';
import { FEATURE } from '../map/types.ts';
import { fpMul, intDiv, type Fp } from '../math/int.ts';
import { cityGold } from '../state/city-output.ts';
import { NEUTRAL, type MatchState, type Player } from '../state/types.ts';

export interface IncomeBase {
  pop: number;
  isolatedPop: number;
  mines: number;
  isolatedMines: number;
  /** Золото городов в секунду с изоляцией и выработкой, fixed-point. */
  cityGold: number;
}

// Шахты — свойство карты: список гексов считаем раз, а не проверяем признак у каждого гекса каждый тик.
const mineLists = new WeakMap<MatchState['map'], number[]>();

function mineHexes(map: MatchState['map']): readonly number[] {
  let list = mineLists.get(map);
  if (list === undefined) {
    list = [];
    for (let id = 0; id < map.features.length; id += 1) {
      if (map.features[id] === FEATURE.mine) list.push(id);
    }
    mineLists.set(map, list);
  }
  return list;
}

export function incomeBases(state: MatchState): IncomeBase[] {
  const bases: IncomeBase[] = state.players.map(() => ({
    pop: 0,
    isolatedPop: 0,
    mines: 0,
    isolatedMines: 0,
    cityGold: 0,
  }));
  const { cut } = cityCoverage(state);
  const { owner, pop } = state.hexes;
  for (let id = 0; id < owner.length; id += 1) {
    const base = bases[owner[id] ?? NEUTRAL];
    if (!base) continue;
    if (cut[id] === 1) base.isolatedPop += pop[id] ?? 0;
    else base.pop += pop[id] ?? 0;
  }
  for (const id of mineHexes(state.map)) {
    const base = bases[owner[id] ?? NEUTRAL];
    if (!base) continue;
    if (cut[id] === 1) base.isolatedMines += 1;
    else base.mines += 1;
  }
  for (const c of state.cities) {
    const base = bases[c.owner];
    if (!base) continue;
    base.cityGold += cityGold(state, c);
  }
  return bases;
}

export function incomePerSecond(pop: number, tax: Fp, mines: number): number {
  return fpMul(fpMul(pop as Fp, tax), GOLD_PER_POP_TAX) + MINE_GOLD_PER_S * mines;
}

/**
 * Доход игрока в секунду по текущему состоянию; tax — ставка для расчёта (по умолчанию
 * фактическая), чтобы интерфейс мог показать итог выбранной ставки.
 * @returns fixed-point золота в секунду
 */
export function playerIncomePerSecond(
  state: MatchState,
  playerId: number,
  tax?: Fp,
  bases: readonly IncomeBase[] = incomeBases(state),
): number {
  const b = bases[playerId];
  const p = state.players[playerId];
  if (!b || !p) return 0;
  return withChaos(p, incomeFromBase(b, tax ?? p.taxEffective));
}

// «Смута» после переноса столицы: доход × CAPITAL_CHAOS_INCOME_MULT (03-cities-buildings.md).
function withChaos(p: Player, income: number): number {
  return p.chaosTicks > 0 ? fpMul(income as Fp, CAPITAL_CHAOS_INCOME_MULT) : income;
}

// Одна формула для начисления и для подсказок интерфейса.
function incomeFromBase(b: IncomeBase, rate: Fp): number {
  const connected = incomePerSecond(b.pop, rate, b.mines);
  const isolated = incomePerSecond(b.isolatedPop, rate, b.isolatedMines);
  return connected + fpMul(isolated as Fp, ISOLATED_INCOME_MULT) + b.cityGold;
}

/**
 * Содержание отрядов игрока: expense/с = Σ(soldiers × upkeep(type) + upkeepPerUnit).
 * @returns fixed-point золота в секунду
 */
export function playerUpkeepPerSecond(state: MatchState, playerId: number): number {
  let total = 0;
  for (const a of state.units) {
    if (a.owner === playerId) {
      total +=
        fpMul(a.soldiers, UPKEEP_GOLD_PER_SOLDIER_S[a.type]) + UPKEEP_GOLD_PER_UNIT_S[a.type];
    }
  }
  return total;
}

/**
 * Начисляет баланс за тик:
 * income/с = Σpop × taxEffective × GOLD_PER_POP_TAX + Σ CITY_GOLD_PER_LEVEL × level + Σ MINE_GOLD_PER_S
 * (для гексов и городов изолированных сетей — × ISOLATED_INCOME_MULT) − содержание отрядов.
 * Золото не уходит в минус; казна пуста при отрицательном балансе — банкротство.
 */
export function economySystem(state: MatchState): void {
  const bases = incomeBases(state);
  state.players.forEach((p, i) => {
    const b = bases[i];
    if (p.status !== 'alive' || !b) return;
    const net = withChaos(p, incomeFromBase(b, p.taxEffective)) - playerUpkeepPerSecond(state, i);
    p.gold = Math.max(0, p.gold + intDiv(net, TICKS_PER_S)) as Fp;
    p.bankrupt = p.gold === 0 && net < 0;
  });
}
