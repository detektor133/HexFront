// Свободные стартовые точки: столица может стоять на любом сухопутном гексе, а не только на
// заранее заданных спавнах карты. GDD: docs/gdd/08-match.md — «Старт».
import { TERRAIN, type MapStatic } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, ring, type Hex, type HexId } from '../math/hex.ts';
import { fork, nextInt, RNG_STREAM } from '../rng.ts';

/** Ближе этого числа гексов друг к другу столицы не ставятся (если на карте есть место). */
export const START_GAP = 6;
/** Желаемое расстояние между случайными стартами: по шагам уменьшается, пока места не хватит. */
const RANDOM_GAPS: readonly number[] = [10, 8, 6, 4, 2];
const TRIES_PER_GAP = 60;

/**
 * Расставляет столицы всех игроков. Сначала по зерну матча строится случайная раскладка для всех
 * мест — она не зависит от выбора людей, поэтому боты никогда не двигаются. Затем желаемое место
 * человека (`wanted[i]`, id гекса) заменяет его случайное: сдвигается к ближайшему подходящему гексу
 * (суша, не гора, не город, не вплотную к чужой столице). Клиент и сервер получают один результат.
 * @returns столица игрока `i` — гекс `result[i]`
 */
export function planStarts(
  map: MapStatic,
  seed: number,
  wanted: readonly (HexId | null | undefined)[],
): Hex[] {
  const { width, height } = map;
  const cityHexes = new Set(map.cities.map((city) => hexId(city, width)));
  let taken: Hex[] = [];
  const usable = (h: Hex, gap: number): boolean => {
    if (!inBounds(h, width, height)) return false;
    const id = hexId(h, width);
    const terrain = map.terrain[id];
    if (terrain === TERRAIN.water || terrain === TERRAIN.mountains || cityHexes.has(id)) {
      return false;
    }
    return taken.every((other) => distance(other, h) >= gap);
  };
  const rng = fork(seed, RNG_STREAM.spawns);
  const total = width * height;
  const place = (gap: number): Hex | undefined => {
    for (let attempt = 0; attempt < TRIES_PER_GAP; attempt += 1) {
      const h = hexFromId(nextInt(rng, total), width);
      if (usable(h, gap)) return h;
    }
    return undefined;
  };
  const result: Hex[] = wanted.map(() => {
    let found: Hex | undefined;
    for (const gap of RANDOM_GAPS) {
      found = place(gap);
      if (found !== undefined) break;
    }
    if (found === undefined) {
      // Совсем тесная карта: первый подходящий гекс подряд, чтобы матч всё же начался.
      for (let id = 0; id < total && found === undefined; id += 1) {
        const h = hexFromId(id, width);
        if (usable(h, 1)) found = h;
      }
    }
    const hex = found ?? hexFromId(0, width);
    taken.push(hex);
    return hex;
  });
  const reach = Math.max(width, height);
  /** Ближайший к `center` гекс, подходящий при текущем `taken`; сам `center`, если он подходит. */
  const nearest = (center: Hex): Hex | undefined => {
    for (let radius = 0; radius <= reach; radius += 1) {
      const hit = (radius === 0 ? [center] : ring(center, radius)).find((h) =>
        usable(h, START_GAP),
      );
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  // Выбор человека — ровно тот гекс, куда он нажал; двигается только когда рядом уже стоит выбор
  // другого человека (или гекс — вода, гора, город). Случайные места занятые рядом уступают ему.
  const fixed: number[] = [];
  wanted.forEach((want, index) => {
    if (want === null || want === undefined || want < 0 || want >= total) return;
    taken = fixed.map((other) => result[other]).filter((h): h is Hex => h !== undefined);
    const hit = nearest(hexFromId(want, width));
    if (hit !== undefined) result[index] = hit;
    fixed.push(index);
  });
  if (fixed.length > 0) {
    result.forEach((own, index) => {
      if (fixed.includes(index)) return;
      taken = result.filter((_, other) => other !== index);
      if (usable(own, START_GAP)) return;
      const hit = nearest(own);
      if (hit !== undefined) result[index] = hit;
    });
  }
  return result;
}
