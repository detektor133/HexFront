// Реестр кэшей производных данных. Любой тяжёлый расчёт по слоям состояния оформляется как
// `memo(state, ключ, слои, расчёт)`: он выполняется заново только при изменении версии одного из
// перечисленных слоёв (state/layers.ts). Так новая механика не «ломает» скорость тихо: кэш либо
// корректен автоматически, либо аудит в тестах падает с названием ключа.
// Архитектура: docs/architecture/performance.md, «Версии слоёв и кэши».
import { layerRevision, type Layer } from './layers.ts';
import type { MatchState } from './types.ts';

interface Entry {
  revisions: number[];
  value: unknown;
}

interface Stats {
  hits: number;
  recomputes: number;
}

const entries = new WeakMap<MatchState, Map<string, Entry>>();
const stats = new WeakMap<MatchState, Map<string, Stats>>();

// Аудит: каждое N-е попадание в кэш пересчитывается заново и сверяется. В игре выключен (0),
// в тестах sim включается из vitest-настройки: застарелый кэш падает сразу с понятным текстом.
let auditEvery = 0;
let auditCounter = 0;

/** Включает аудит кэшей: каждое `every`-е попадание проверяется пересчётом; 0 — выключить. */
export function configureDerivedAudit(every: number): void {
  auditEvery = every;
  auditCounter = 0;
}

function statsOf(state: MatchState, key: string): Stats {
  let byKey = stats.get(state);
  if (byKey === undefined) {
    byKey = new Map();
    stats.set(state, byKey);
  }
  let current = byKey.get(key);
  if (current === undefined) {
    current = { hits: 0, recomputes: 0 };
    byKey.set(key, current);
  }
  return current;
}

/** Попадания в кэш и пересчёты по ключам для состояния (метрики и тесты бюджета). */
export function derivedStats(state: MatchState): ReadonlyMap<string, Readonly<Stats>> {
  return stats.get(state) ?? new Map();
}

/** Глубокое сравнение значений кэша: типизированные массивы, массивы, Map, записи. */
export function sameDerived(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
    return true;
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !sameDerived(v, b.get(k))) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameDerived(v, b[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => sameDerived(x[k], y[k]));
}

/**
 * Значение производных данных: из кэша, пока версии слоёв `layers` не менялись, иначе пересчёт.
 * Результат нельзя менять: он общий для всех, кто его запросил.
 * @returns кэшированное или свежее значение `compute()`
 */
export function memo<T>(
  state: MatchState,
  key: string,
  layers: readonly Layer[],
  compute: () => T,
  extra: readonly number[] = [],
): T {
  let byKey = entries.get(state);
  if (byKey === undefined) {
    byKey = new Map();
    entries.set(state, byKey);
  }
  const current = [...layers.map((layer) => layerRevision(state, layer)), ...extra];
  const cached = byKey.get(key);
  const counters = statsOf(state, key);
  if (cached !== undefined && cached.revisions.every((r, i) => r === current[i])) {
    counters.hits += 1;
    if (auditEvery > 0 && ++auditCounter % auditEvery === 0) {
      if (!sameDerived(cached.value, compute())) {
        throw new Error(
          `Кэш «${key}» устарел: слой изменили в обход state/layers.ts или в зависимостях не хватает слоя (${layers.join(', ')}).`,
        );
      }
    }
    return cached.value as T;
  }
  counters.recomputes += 1;
  const value = compute();
  byKey.set(key, { revisions: current, value });
  return value;
}
