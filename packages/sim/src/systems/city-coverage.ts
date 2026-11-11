// Покрытие городов: какой «городской» рост получает каждый гекс и какие гексы отрезаны от основной
// сети. Раньше рост населения и доход считали это двумя отдельными обходами колец вокруг городов с
// объектом на гекс и по два раза за тик (система и вид игрока). Теперь это один результат, который
// пересчитывается только при изменении владельцев гексов или состава и состояния городов.
// GDD: docs/gdd/02-economy.md — «Население», «Золото».
import {
  CITY_LEVEL_GROWTH_STEP,
  GROWTH_BACKGROUND,
  GROWTH_CITY_HEX,
  GROWTH_RING1,
  GROWTH_RING2,
  ISOLATED_GROWTH_MULT,
} from '../balance.ts';
import { hexDistanceById } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

/** Радиус, в котором гекс относится к городу (кольца 0–2). */
export const COVERAGE_RADIUS = 2;

/** Базовый рост по кольцу от города: сам город, кольцо 1, кольцо 2 (людей/с). */
export const BASE_GROWTH: readonly Fp[] = [GROWTH_CITY_HEX, GROWTH_RING1, GROWTH_RING2];

/**
 * Множитель уровня города: cityLevelMult = 1 + 0,25 × (level − 1).
 * @returns fixed-point
 */
export function cityLevelMult(level: number): Fp {
  return (FP + CITY_LEVEL_GROWTH_STEP * (level - 1)) as Fp;
}

/** Результат: рост и отрезанность гексов; массивы только для чтения. */
export interface CityCoverage {
  /** «Городская» часть роста гекса, fixed-point людей/с; 0 — гекс вне населённой земли. */
  readonly best: Int32Array;
  /** 1 — все свои города в радиусе гекса изолированы от основной сети (налог ×0,5). */
  readonly cut: Uint8Array;
}

interface Entry {
  readonly owner: Int16Array;
  readonly sig: Int32Array;
  readonly value: CityCoverage;
}

const SIG_FIELDS = 5;
const entries = new WeakMap<MatchState, Entry>();

// Город изолирован, если его сеть не основная; нет сети — не изолирован (как isCityIsolated).
function isolatedCities(state: MatchState): boolean[] {
  const main = new Set<number>();
  for (const n of state.networks) if (n.isMain) main.add(n.id);
  return state.cities.map((c) => {
    const id = state.hexes.network[c.hex] ?? -1;
    return id >= 0 && !main.has(id);
  });
}

function signature(state: MatchState, isolated: readonly boolean[]): Int32Array {
  const sig = new Int32Array(state.cities.length * SIG_FIELDS);
  state.cities.forEach((c, i) => {
    const at = i * SIG_FIELDS;
    sig[at] = c.id;
    sig[at + 1] = c.hex;
    sig[at + 2] = c.level;
    sig[at + 3] = c.owner;
    sig[at + 4] = isolated[i] ? 1 : 0;
  });
  return sig;
}

function sameInts(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function compute(state: MatchState, isolated: readonly boolean[]): CityCoverage {
  const { width, height } = state.map;
  const { owner } = state.hexes;
  const best = new Int32Array(width * height);
  const covered = new Uint8Array(width * height);
  const connected = new Uint8Array(width * height);
  state.cities.forEach((c, index) => {
    if (c.owner === NEUTRAL) return;
    const isMain = !isolated[index];
    const parts = BASE_GROWTH.map((base) =>
      fpMul(
        base,
        fpMul(cityLevelMult(c.level), isolated[index] ? ISOLATED_GROWTH_MULT : (FP as Fp)),
      ),
    );
    const col = c.hex % width;
    const row = intDiv(c.hex, width);
    for (
      let r = Math.max(0, row - COVERAGE_RADIUS);
      r <= Math.min(height - 1, row + COVERAGE_RADIUS);
      r += 1
    ) {
      for (
        let q = Math.max(0, col - COVERAGE_RADIUS);
        q <= Math.min(width - 1, col + COVERAGE_RADIUS);
        q += 1
      ) {
        const id = r * width + q;
        const d = hexDistanceById(id, c.hex, width);
        if (d > COVERAGE_RADIUS || owner[id] !== c.owner) continue;
        const g = parts[d] ?? 0;
        if (g > (best[id] ?? 0)) best[id] = g;
        covered[id] = 1;
        if (isMain) connected[id] = 1;
      }
    }
  });
  const cut = new Uint8Array(width * height);
  for (let id = 0; id < cut.length; id += 1) {
    // Свои гексы вне радиуса городов обживаются фоново — иначе основать город негде (02-economy.md).
    if (owner[id] !== NEUTRAL && best[id] === 0) best[id] = GROWTH_BACKGROUND;
    cut[id] = covered[id] === 1 && connected[id] === 0 ? 1 : 0;
  }
  return { best, cut };
}

/**
 * Покрытие городов для текущего состояния; повторные вызовы в пределах неизменного состояния
 * (система населения, вид игрока, доход) возвращают тот же результат без пересчёта.
 * @returns рост по гексам и признак отрезанности; массивы менять нельзя
 */
export function cityCoverage(state: MatchState): CityCoverage {
  const isolated = isolatedCities(state);
  const sig = signature(state, isolated);
  const cached = entries.get(state);
  if (cached && sameInts(cached.owner, state.hexes.owner) && sameInts(cached.sig, sig)) {
    return cached.value;
  }
  const value = compute(state, isolated);
  entries.set(state, { owner: state.hexes.owner.slice(), sig, value });
  return value;
}
