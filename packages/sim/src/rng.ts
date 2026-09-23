// Детерминированный PRNG xoshiro128** для генерации карт и ботов (AGENTS.md §3, п. 5).
// Состояние — обычный объект с 4 словами uint32: сериализуется и хэшируется вместе с матчем.

/** Состояние генератора: четыре 32-битных слова без знака. */
export interface Rng {
  s: [number, number, number, number];
}

const UINT32 = 0x1_0000_0000;
const GOLDEN_GAMMA = 0x9e3779b9;

// splitmix32 разворачивает один сид в 4 слова: xoshiro нельзя запускать из нулевого состояния,
// а близкие сиды без перемешивания дали бы похожие первые числа.
function splitmix32(state: { x: number }): number {
  state.x = (state.x + GOLDEN_GAMMA) >>> 0;
  let z = state.x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Генератор из готового состояния; нужен для сверки с эталонными векторами алгоритма.
 * @returns новый генератор (массив копируется)
 */
export function rngFromState(s: readonly [number, number, number, number]): Rng {
  if (s.every((w) => w === 0)) throw new RangeError('rng: нулевое состояние недопустимо');
  return { s: [s[0] >>> 0, s[1] >>> 0, s[2] >>> 0, s[3] >>> 0] };
}

/**
 * Генератор из 32-битного сида.
 * @returns новый генератор
 */
export function createRng(seed: number): Rng {
  const sm = { x: seed >>> 0 };
  return rngFromState([splitmix32(sm), splitmix32(sm), splitmix32(sm), splitmix32(sm)]);
}

/**
 * Независимый поток `streamId` от сида матча (карта, каждый бот — свой поток).
 * @returns новый генератор
 */
export function fork(seed: number, streamId: number): Rng {
  const sm = { x: (seed ^ Math.imul(streamId >>> 0, GOLDEN_GAMMA)) >>> 0 };
  return createRng(splitmix32(sm) ^ splitmix32({ x: streamId >>> 0 }));
}

/**
 * Следующее число; мутирует состояние генератора.
 * @returns целое 0 ≤ x < 2³²
 */
export function nextU32(rng: Rng): number {
  const s = rng.s;
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/**
 * Равномерное целое без смещения (отбраковка хвоста диапазона).
 * @returns целое 0 ≤ x < bound
 */
export function nextInt(rng: Rng, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0 || bound > UINT32) {
    throw new RangeError(`rng: недопустимая граница ${bound}`);
  }
  const limit = UINT32 - (UINT32 % bound);
  let x = nextU32(rng);
  while (x >= limit) x = nextU32(rng);
  return x % bound;
}

/**
 * Равномерное целое на отрезке [min, max].
 * @returns целое min ≤ x ≤ max
 */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + nextInt(rng, max - min + 1);
}
