// Доход игроков: налог с населения, города, шахты; изолированные сети — ×0,5. Содержание отрядов
// и банкротство. GDD: docs/gdd/02-economy.md — «Золото», «Банкротство»; 04-roads-supply.md.
import {
  CAPITAL_CHAOS_INCOME_MULT,
  GOLD_PER_POP_TAX,
  ISOLATED_INCOME_MULT,
  MINE_GOLD_PER_S,
  TICKS_PER_S,
  UPKEEP_GOLD_PER_SOLDIER_S,
} from '../balance.ts';
import { FEATURE } from '../map/types.ts';
import { hexFromId, hexId, inBounds, spiral } from '../math/hex.ts';
import { fpMul, intDiv, type Fp } from '../math/int.ts';
import { cityGold } from '../state/city-output.ts';
import { isCityIsolated } from '../state/network.ts';
import { NEUTRAL, type MatchState, type Player } from '../state/types.ts';

/** Радиус, в котором гекс относится к городу (тот же, что у роста населения). */
const COVERAGE_RADIUS = 2;

// Налог гекса ×0,5, только если все свои города в радиусе 2 от него изолированы; хоть один
// город основной сети рядом — налог полный. Вне радиуса городов — без штрафа (02-economy.md, «Золото»).
function isolatedHexes(state: MatchState): Uint8Array {
  const { width, height } = state.map;
  const covered = new Uint8Array(width * height);
  const connected = new Uint8Array(width * height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const isMain = !isCityIsolated(state, c.id);
    for (const h of spiral(hexFromId(c.hex, width), COVERAGE_RADIUS)) {
      if (!inBounds(h, width, height)) continue;
      const id = hexId(h, width);
      if (state.hexes.owner[id] !== c.owner) continue;
      covered[id] = 1;
      if (isMain) connected[id] = 1;
    }
  }
  return covered.map((cov, id) => (cov === 1 && connected[id] === 0 ? 1 : 0));
}

interface Base {
  pop: number;
  isolatedPop: number;
  mines: number;
  isolatedMines: number;
  /** Золото городов в секунду с изоляцией и выработкой, fixed-point. */
  cityGold: number;
}

function incomeBases(state: MatchState): Base[] {
  const bases: Base[] = state.players.map(() => ({
    pop: 0,
    isolatedPop: 0,
    mines: 0,
    isolatedMines: 0,
    cityGold: 0,
  }));
  const cut = isolatedHexes(state);
  const { owner, pop } = state.hexes;
  for (let id = 0; id < owner.length; id += 1) {
    const base = bases[owner[id] ?? NEUTRAL];
    if (!base) continue;
    const isolated = cut[id] === 1;
    if (isolated) base.isolatedPop += pop[id] ?? 0;
    else base.pop += pop[id] ?? 0;
    if (state.map.features[id] !== FEATURE.mine) continue;
    if (isolated) base.isolatedMines += 1;
    else base.mines += 1;
  }
  for (const c of state.cities) {
    const base = bases[c.owner];
    if (!base) continue;
    base.cityGold += cityGold(state, c);
  }
  return bases;
}

function incomePerSecond(pop: number, tax: Fp, mines: number): number {
  return fpMul(fpMul(pop as Fp, tax), GOLD_PER_POP_TAX) + MINE_GOLD_PER_S * mines;
}

/**
 * Доход игрока в секунду по текущему состоянию; tax — ставка для расчёта (по умолчанию
 * фактическая), чтобы интерфейс мог показать итог выбранной ставки.
 * @returns fixed-point золота в секунду
 */
export function playerIncomePerSecond(state: MatchState, playerId: number, tax?: Fp): number {
  const b = incomeBases(state)[playerId];
  const p = state.players[playerId];
  if (!b || !p) return 0;
  return withChaos(p, incomeFromBase(b, tax ?? p.taxEffective));
}

// «Смута» после переноса столицы: доход × CAPITAL_CHAOS_INCOME_MULT (03-cities-buildings.md).
function withChaos(p: Player, income: number): number {
  return p.chaosTicks > 0 ? fpMul(income as Fp, CAPITAL_CHAOS_INCOME_MULT) : income;
}

// Одна формула для начисления и для подсказок интерфейса.
function incomeFromBase(b: Base, rate: Fp): number {
  const connected = incomePerSecond(b.pop, rate, b.mines);
  const isolated = incomePerSecond(b.isolatedPop, rate, b.isolatedMines);
  return connected + fpMul(isolated as Fp, ISOLATED_INCOME_MULT) + b.cityGold;
}

/**
 * Содержание отрядов игрока: expense/с = Σ soldiers × UPKEEP_GOLD_PER_SOLDIER_S(type).
 * @returns fixed-point золота в секунду
 */
export function playerUpkeepPerSecond(state: MatchState, playerId: number): number {
  let total = 0;
  for (const a of state.units) {
    if (a.owner === playerId) total += fpMul(a.soldiers, UPKEEP_GOLD_PER_SOLDIER_S[a.type]);
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
