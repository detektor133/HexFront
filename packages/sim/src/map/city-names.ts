// Названия городов и государств-ботов. Одна форма для всех: латиницей, собираются из слогов своей
// «культуры» (у каждого государства свой звук: славянский, тюркский, английский…), поэтому игроки
// на любом языке видят и произносят одно и то же. Выбор детерминирован по зерну матча, id и занятым
// названиям. Игрок может задать свой список названий: они идут первыми, по порядку.
import { intDiv } from '../math/int.ts';
import type { City } from '../state/types.ts';

/** Предел длины названия города, символов (для названий, которые вводит игрок). */
export const CITY_NAME_MAX = 24;
/** Сколько своих названий игрок может задать. */
export const CITY_POOL_MAX = 30;

interface Culture {
  /** Начала слов. */
  readonly starts: readonly string[];
  /** Окончания городов. */
  readonly ends: readonly string[];
  /** Окончания государств. */
  readonly lands: readonly string[];
}

const words = (text: string): readonly string[] => text.split(' ');

const CULTURES: readonly Culture[] = [
  {
    starts: words(
      'Vel Kras Nov Bel Zlat Dub Mir Sever Ost Volk Yar Lesn Kam Zar Gor Rus Svet Tikh',
    ),
    ends: words('grad sk ov ino pol bor gorsk vitsa ets ichi'),
    lands: words('ia ovia land gard'),
  },
  {
    starts: words('Kara Ak Sar Dem Yesil Kizil Bal Tash Ala Hisar Bey Kor Yildiz Mavi'),
    ends: words('hisar kale abad beyli kent pasha dag ova tepe shehir'),
    lands: words('ia istan elia ova'),
  },
  {
    starts: words('Ash Brad Cal Dun Ever Fair Glen Har Ket Lan Mar Nor Os Pen Ros Stan Thorn Wex'),
    ends: words('ford ton wick bury ham mouth chester field haven dale'),
    lands: words('land ia shire mark'),
  },
  {
    starts: words('Beau Mont Saint Val Roche Clair Bel Lor Aix Dor Mar Vil Cha Auv'),
    ends: words('mont ville bourg court val champ ois ac ne lac'),
    lands: words('ie ia aine ois'),
  },
  {
    starts: words('Hohen Wald Stein Berg Eisen Nord Rhein Gross Alt Neu Wolf Kron Silber Rot'),
    ends: words('burg stadt heim dorf furt berg bach brunn hafen au'),
    lands: words('land mark ia reich'),
  },
  {
    starts: words('San Santa Villa Monte Alto Rio Sierra Costa Puerto Vega Torre Toro Cala Mar'),
    ends: words('ona ada illo anca osa eda ez ara ela ina'),
    lands: words('ia ana ona oria'),
  },
  {
    starts: words('Monte Porto Castel Santa Villa Rocca Borgo Val Cima Lago Terra Fiore Sol Bel'),
    ends: words('ino ello ara ona ezia oro ano iano etto enza'),
    lands: words('ia ana ona ria'),
  },
  {
    starts: words('Taka Yama Kawa Shira Mori Hana Kita Higa Nishi Oka Sato Fuji Ume Tsuki'),
    ends: words('saki shima gawa yama hara mura zawa oka ura to'),
    lands: words('koku kyo jima ra'),
  },
  {
    starts: words('Bei Nan Dong Xi Chang Huang Qing Shan Hai Long Jin Ping Ling Wu'),
    ends: words('jing hai an yang zhou chuan cheng shan kou ning'),
    lands: words('guo chao dao han'),
  },
  {
    starts: words('Shah Dar Kor Ras Mah Zar Nur Fars Jaz Bah Sam Tab Kash Hor'),
    ends: words('abad stan shahr pur kand iyah dar bad rud an'),
    lands: words('istan ia shahr an'),
  },
  {
    starts: words('Skar Hel Bjorn Frost Storm Ulf Vik Thor Gard Ness Lund Odd Ravn Sol'),
    ends: words('heim vik by stad fjord borg holm nes dal haven'),
    lands: words('land mark heim rike'),
  },
  {
    starts: words('Neo Thessa Alex Corin Mega Pelo Anti Phil Cael Aurel Septi Nova Hera Vesta'),
    ends: words('polis ia ium onia ona ea ika os opolis aea'),
    lands: words('ia onia polis ea'),
  },
];

/** Культур (звучаний) в таблице. */
export const CULTURE_COUNT = CULTURES.length;

/** Целочисленный хэш трёх чисел (без Math.random): одинаков на сервере и в браузере. */
function hash32(a: number, b: number, c: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Выбор по хэшу: остаток даёт элемент, частное идёт на следующий выбор. */
function take<T>(list: readonly T[], h: number): { item: T; rest: number } {
  return { item: list[h % list.length] as T, rest: intDiv(h, list.length) };
}

/** Знак «нижняя черта» после каждой буквы: подчёркнутое слово в любом тексте, в том числе на холсте карты. */
const LOW_LINE = '̲';

/** Подчёркивает все буквы (так везде отличаются боты). */
export function underlined(text: string): string {
  return Array.from(text, (ch) => `${ch}${LOW_LINE}`).join('');
}

/**
 * Культура игрока в матче: перестановка культур от зерна, игрок `i` берёт `i`-ю (по кругу).
 * @returns номер культуры
 */
export function cultureOf(seed: number, playerId: number): number {
  const order = Array.from({ length: CULTURE_COUNT }, (_, i) => i).sort(
    (a, b) => hash32(seed, a, 77) - hash32(seed, b, 77) || a - b,
  );
  return order[playerId % CULTURE_COUNT] ?? 0;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Слоговое название города: начало + окончание; стык одинаковых букв («Roccaano») схлопывается. */
function cityWord(culture: Culture, h: number): string {
  const a = take(culture.starts, h);
  const e = take(culture.ends, a.rest);
  const start = a.item;
  const end = start.toLowerCase() === e.item ? `${e.rest % 2 === 0 ? 'o' : 'a'}${e.item}` : e.item;
  return start.endsWith(end.charAt(0)) ? `${start}${end.slice(1)}` : `${start}${end}`;
}

/**
 * Название государства-бота: слоговая основа и окончание страны, подчёркнутое. Занятые не повторяются.
 * @param taken уже выданные названия (в том числе подчёркнутые)
 */
export function botName(seed: number, playerId: number, taken: readonly string[] = []): string {
  const culture = CULTURES[cultureOf(seed, playerId)] as Culture;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const h = hash32(seed, playerId, 1000 + attempt);
    const stem = take(culture.starts, h);
    const land = take(culture.lands, stem.rest);
    const text = underlined(capitalize(`${stem.item}${land.item}`).slice(0, CITY_NAME_MAX));
    if (!taken.includes(text)) return text;
  }
  return underlined(`Bot ${playerId + 1}`);
}

/**
 * Приводит список названий игрока к допустимому: без пробелов по краям, не длиннее предела, без
 * повторов и пустых строк, не больше CITY_POOL_MAX.
 */
export function cleanCityPool(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/gu, ' ').slice(0, CITY_NAME_MAX);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length === CITY_POOL_MAX) break;
  }
  return result;
}

/**
 * Свободное название города. Сначала свой список игрока по порядку, потом слоговое название его
 * культуры; ничей город берёт культуру по хэшу. Уже занятые названия пропускаются.
 * @param owner игрок-владелец; `null` — ничей город
 * @param pool свой список названий игрока
 */
export function pickCityName(
  seed: number,
  cityId: number,
  cities: readonly City[],
  owner: number | null = null,
  pool: readonly string[] = [],
): string {
  const used = new Set(cities.map((c) => c.name));
  for (const name of pool) if (!used.has(name)) return name;
  const index =
    owner !== null && owner >= 0 ? cultureOf(seed, owner) : hash32(seed, cityId, 5) % CULTURE_COUNT;
  const culture = CULTURES[index] as Culture;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const name = capitalize(cityWord(culture, hash32(seed, cityId, attempt)));
    if (!used.has(name)) return name.slice(0, CITY_NAME_MAX);
  }
  return `City ${cityId}`;
}
