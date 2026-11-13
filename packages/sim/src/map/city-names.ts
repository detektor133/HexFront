// Названия городов и ботов. Симуляция не знает языка, поэтому в состоянии лежит не готовое слово, а
// короткий код (`~n:<государство>:<номер>`), а клиент подставляет слово на языке игрока. Таблицы слов —
// в клиенте (`apps/client/src/i18n/names.ts`); здесь только их размеры и детерминированный выбор.
// Название, которое игрок ввёл сам (команда renameCity), хранится как обычный текст.
import { intDiv } from '../math/int.ts';
import type { City } from '../state/types.ts';

/** Предел длины названия города, символов (для названий, которые вводит игрок). */
export const CITY_NAME_MAX = 24;

/** Государств в таблице; у каждого свой список городов. Должно совпадать с таблицей клиента. */
export const NATION_COUNT = 12;
/** Городов в списке одного государства: сначала столица, дальше основанные города по порядку. */
export const NATION_CITY_COUNT = 10;
/** Размеры таблиц составных названий (начало слова + окончание): «Бело» + «горск». */
export const GEN_PREFIX_COUNT = 24;
export const GEN_SUFFIX_COUNT = 16;

/** Целочисленный хэш трёх чисел (без Math.random): одинаков на сервере и в браузере. */
function hash32(a: number, b: number, c: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Государство игрока в матче: перестановка государств от зерна, игрок `i` берёт `i`-е. Когда игроков
 * больше, чем государств, они повторяются со следующим «кругом» (II, III… в названии).
 * @returns номер государства и круг (0 — первый)
 */
export function nationOf(seed: number, playerId: number): { nation: number; lap: number } {
  const order = Array.from({ length: NATION_COUNT }, (_, i) => i).sort(
    (a, b) => hash32(seed, a, 77) - hash32(seed, b, 77) || a - b,
  );
  return {
    nation: order[playerId % NATION_COUNT] ?? 0,
    lap: intDiv(playerId, NATION_COUNT),
  };
}

/** Название бота: код государства, клиент покажет «Российская империя» и пометит бота подчёркиванием. */
export function botName(seed: number, playerId: number): string {
  const { nation, lap } = nationOf(seed, playerId);
  return `~b:${nation}:${lap}`;
}

/**
 * Свободное название города. Город игрока берёт следующее по порядку из списка его государства,
 * ничей город и переполнение списка — составное слово по хэшу зерна и id. Уже занятые пропускаются.
 * @param owner игрок-владелец; `null` — ничей город
 * @returns код названия
 */
export function pickCityName(
  seed: number,
  cityId: number,
  cities: readonly City[],
  owner: number | null = null,
): string {
  const used = new Set(cities.map((c) => c.name));
  if (owner !== null && owner >= 0) {
    const { nation } = nationOf(seed, owner);
    for (let index = 0; index < NATION_CITY_COUNT; index += 1) {
      const code = `~n:${nation}:${index}`;
      if (!used.has(code)) return code;
    }
  }
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const h = hash32(seed, cityId, attempt);
    const code = `~g:${h % GEN_PREFIX_COUNT}:${intDiv(h, GEN_PREFIX_COUNT) % GEN_SUFFIX_COUNT}`;
    if (!used.has(code)) return code;
  }
  return `~g:0:${cityId % GEN_SUFFIX_COUNT}`;
}
