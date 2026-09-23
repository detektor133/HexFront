// Статическая карта матча (формат v1). GDD: docs/gdd/01-map.md — «Формат карты».
import type { Hex } from '../math/hex.ts';

/** Коды местности в массиве `terrain`; 0 — вода, чтобы пустой массив был морем. */
export const TERRAIN = {
  water: 0,
  plains: 1,
  forest: 2,
  hills: 3,
  mountains: 4,
  desert: 5,
} as const;

export type TerrainName = keyof typeof TERRAIN;
export type TerrainCode = (typeof TERRAIN)[TerrainName];

/** Названия местности по коду; индекс — код. */
export const TERRAIN_NAMES: readonly TerrainName[] = [
  'water',
  'plains',
  'forest',
  'hills',
  'mountains',
  'desert',
];

/** Коды особых гексов в массиве `features`; 0 — нет особенности. */
export const FEATURE = { none: 0, fertile: 1, mine: 2, pass: 3 } as const;

export type FeatureName = Exclude<keyof typeof FEATURE, 'none'>;

/** Нейтральный город на карте при старте. */
export interface MapCity {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly name: string;
  /** Уровень 1–3. */
  readonly level: number;
  /** Гарнизон, солдат (целое, как в JSON). */
  readonly garrison: number;
}

/** Неизменяемая часть матча. Массивы — по HexId (`col + row·width`). */
export interface MapStatic {
  readonly version: 1;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Код местности на гекс. */
  readonly terrain: Uint8Array;
  /** Код особенности на гекс. */
  readonly features: Uint8Array;
  /** Битовая маска рёбер с рекой по направлениям 0–5; хранится с обеих сторон ребра. */
  readonly rivers: Uint8Array;
  /** 1 — на гексе дорога. */
  readonly roads: Uint8Array;
  /** Отсортированы по id. */
  readonly cities: readonly MapCity[];
  readonly spawns: readonly Hex[];
}

/** Карта в JSON-формате v1, как в docs/gdd/01-map.md. */
export interface MapJson {
  version: 1;
  id: string;
  width: number;
  height: number;
  /** base64 Uint8Array (width·height), коды TERRAIN. */
  terrain: string;
  features: { q: number; r: number; type: FeatureName }[];
  /** [q, r, dir], dir 0–2. */
  riverEdges: [number, number, number][];
  /** base64 битсет (width·height), бит i — в байте i >> 3, младший бит первый. */
  roads: string;
  cities: MapCity[];
  spawns: { q: number; r: number }[];
}
