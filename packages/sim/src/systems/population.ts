// Рост и убыль населения по гексам.
// GDD: docs/gdd/02-economy.md — «Население»
import {
  BASE_POP_CAP,
  FERTILE_CAP_MULT,
  GROWTH_BACKGROUND,
  IMPROVEMENT_CAP_STEP,
  IMPROVEMENT_GROWTH_STEP,
  ISOLATED_GROWTH_MULT,
  POP_OVERCAP_DECAY,
  TICKS_PER_S,
} from '../balance.ts';
import { BASE_GROWTH, cityCoverage, cityLevelMult } from './city-coverage.ts';
import { taxGrowthMult } from './tax.ts';
import { FEATURE, TERRAIN_NAMES } from '../map/types.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { isCityIsolated } from '../state/network.ts';
import { cityPopCap, hexPopCap } from '../state/pop-cap.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

export { cityLevelMult };

// «Городская» часть роста: baseGrowth(ring) × cityLevelMult × networkMult.
// Остальные множители одинаковы для всех городов гекса, поэтому максимум берётся по этой части.
function cityGrowthPart(
  state: MatchState,
  cityId: number,
  level: number,
  ringIndex: number,
): number {
  const networkMult = isCityIsolated(state, cityId) ? ISOLATED_GROWTH_MULT : (FP as Fp);
  return fpMul(BASE_GROWTH[ringIndex] ?? (0 as Fp), fpMul(cityLevelMult(level), networkMult));
}

// Лимит населения гекса без улучшений зависит только от карты (рельеф и плодородие): считаем раз.
const baseCaps = new WeakMap<MatchState['map'], Int32Array>();

function baseCapTable(map: MatchState['map']): Int32Array {
  const cached = baseCaps.get(map);
  if (cached) return cached;
  const table = new Int32Array(map.width * map.height);
  for (let hex = 0; hex < table.length; hex += 1) {
    const name = TERRAIN_NAMES[map.terrain[hex] ?? 0];
    if (name === undefined || name === 'water') continue;
    const feature = map.features[hex] === FEATURE.fertile ? FERTILE_CAP_MULT : (FP as Fp);
    table[hex] = fpMul(BASE_POP_CAP[name], feature);
  }
  baseCaps.set(map, table);
  return table;
}

/** Таблицы одного прохода по гексам: те же формулы, что hexPopCap и fullGrowth, без вызовов на гекс. */
interface PassTables {
  readonly baseCap: Int32Array;
  readonly levels: Uint8Array;
  readonly best: Int32Array;
  /** Множитель налога по игроку. */
  readonly taxMult: number[];
}

function passTables(state: MatchState): PassTables {
  const levels = new Uint8Array(state.map.width * state.map.height);
  for (const c of state.cities) levels[c.hex] = c.level;
  return {
    baseCap: baseCapTable(state.map),
    levels,
    best: cityCoverage(state).best,
    taxMult: state.players.map((p) => taxGrowthMult(p.taxEffective)),
  };
}

// Лимит населения гекса: городской — по уровню, обычный — рельеф × плодородие × улучшение.
function capAt(tables: PassTables, state: MatchState, id: number): number {
  const level = tables.levels[id] ?? 0;
  if (level > 0) return cityPopCap(level);
  const improvement = (FP + IMPROVEMENT_CAP_STEP * (state.hexes.improvement[id] ?? 0)) as Fp;
  return fpMul((tables.baseCap[id] ?? 0) as Fp, improvement);
}

// Рост до деления на время: fullGrowth × (cap − pop) / cap даёт людей/с в fixed-point.
function growthAt(tables: PassTables, state: MatchState, id: number): number {
  const cityPart = tables.best[id] ?? 0;
  const taxMult = tables.taxMult[state.hexes.owner[id] ?? NEUTRAL];
  if (cityPart === 0 || taxMult === undefined) return 0;
  const improvement = (FP + IMPROVEMENT_GROWTH_STEP * (state.hexes.improvement[id] ?? 0)) as Fp;
  return fpMul(fpMul(cityPart as Fp, improvement), taxMult as Fp);
}

// Рост до деления на время для одного гекса: тот же результат, но для поштучных запросов.
function fullGrowth(state: MatchState, id: number, cityPart: number): number {
  const player = state.players[state.hexes.owner[id] ?? NEUTRAL];
  if (cityPart === 0 || !player) return 0;
  const improvement = (FP + IMPROVEMENT_GROWTH_STEP * (state.hexes.improvement[id] ?? 0)) as Fp;
  return fpMul(fpMul(cityPart as Fp, improvement), taxGrowthMult(player.taxEffective));
}

/**
 * Скорость изменения населения гекса: рост по формуле GDD или убыль 1 %/с сверх лимита.
 * @returns fixed-point людей в секунду (отрицательное — убыль)
 */
export function hexGrowthPerSecond(state: MatchState, hex: number): number {
  const { width } = state.map;
  const city = state.cities.find((c) => c.hex === hex);
  const cap = city ? cityPopCap(city.level) : hexPopCap(state, hex);
  const pop = state.hexes.pop[hex] ?? 0;
  if (pop > cap) return -fpMul(pop as Fp, POP_OVERCAP_DECAY);
  const here = hexFromId(hex, width);
  let best = 0;
  for (const c of state.cities) {
    const d = distance(hexFromId(c.hex, width), here);
    if (c.owner !== state.hexes.owner[hex] || c.owner === NEUTRAL || d >= BASE_GROWTH.length)
      continue;
    best = Math.max(best, cityGrowthPart(state, c.id, c.level, d));
  }
  if (best === 0 && (state.hexes.owner[hex] ?? NEUTRAL) !== NEUTRAL) best = GROWTH_BACKGROUND;
  if (pop === cap || cap === 0) return 0;
  return intDiv(fullGrowth(state, hex, best) * (cap - pop), cap);
}

/**
 * Скорость изменения населения всех гексов — то же, что hexGrowthPerSecond по каждому гексу, но
 * одним проходом по таблицам (снимок игрока строится каждый тик и для каждого commander).
 * @returns fixed-point людей в секунду по HexId (отрицательное — убыль)
 */
export function growthPerSecond(state: MatchState): Int32Array {
  const { hexes } = state;
  const tables = passTables(state);
  const out = new Int32Array(hexes.pop.length);
  for (let id = 0; id < out.length; id += 1) {
    const pop = hexes.pop[id] as number;
    const cap = capAt(tables, state, id);
    if (pop > cap) out[id] = -fpMul(pop as Fp, POP_OVERCAP_DECAY);
    else if (pop !== cap && cap !== 0) {
      out[id] = intDiv(growthAt(tables, state, id) * (cap - pop), cap);
    }
  }
  return out;
}

/**
 * Рост в радиусе 2 от своих городов (максимум по городам), фоновый GROWTH_BACKGROUND на остальных
 * своих гексах, убыль 1 %/с сверх лимита:
 * growth/с = baseGrowth(ring) × cityLevelMult × improvementGrowthMult × taxGrowthMult
 *            × networkMult × (1 − pop / popCap)
 */
export function populationSystem(state: MatchState): void {
  const { hexes } = state;
  const tables = passTables(state);
  for (let id = 0; id < hexes.pop.length; id += 1) {
    const pop = hexes.pop[id] ?? 0;
    const cap = capAt(tables, state, id);
    if (pop > cap) {
      const decay = intDiv(fpMul(pop as Fp, POP_OVERCAP_DECAY), TICKS_PER_S);
      hexes.pop[id] = Math.max(cap, pop - decay);
      continue;
    }
    const full = growthAt(tables, state, id);
    if (full === 0 || pop === cap) continue;
    // Одно деление в конце: доля (1 − pop/cap) и перевод в тики без промежуточного округления.
    const growth = intDiv(full * (cap - pop), cap * TICKS_PER_S);
    hexes.pop[id] = Math.min(cap, pop + growth);
  }
}
