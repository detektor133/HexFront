// Кандидаты палитры местности для выбора владельцем на /dev/map (задача после 01/T8).
// Не токены: после выбора победитель переносится в docs/art/tokens.json, файл удаляется.
// Подбор: суша светлее любой заливки территории (L* > 80,3), ΔE2000 между типами суши ≥ 8.

export interface TerrainPalette {
  readonly id: 'A' | 'B' | 'C';
  readonly water: string;
  readonly plains: string;
  readonly forest: string;
  readonly hills: string;
  readonly mountains: string;
  readonly desert: string;
  /** Цвета узоров: тот же оттенок, темнее — читаются и под заливкой территории. */
  readonly forestInk: string;
  readonly hillInk: string;
  readonly mountainInk: string;
  readonly desertInk: string;
}

export const TERRAIN_CANDIDATES: readonly TerrainPalette[] = [
  {
    id: 'A',
    water: '#AFDBF1',
    plains: '#F7F6F3',
    forest: '#C2E2C4',
    hills: '#E3E5C6',
    mountains: '#CACFD4',
    desert: '#FFE9B9',
    forestInk: '#82B186',
    hillInk: '#A0A37F',
    mountainInk: '#7B858D',
    desertInk: '#D4B174',
  },
  {
    id: 'B',
    water: '#8BD0EF',
    plains: '#F8F6EF',
    forest: '#B3E0B1',
    hills: '#DFE3B5',
    mountains: '#C3CAD0',
    desert: '#FFE49F',
    forestInk: '#6BA36B',
    hillInk: '#959A6B',
    mountainInk: '#6B7983',
    desertInk: '#D0A45C',
  },
  {
    id: 'C',
    water: '#A3DAED',
    plains: '#F5FAFA',
    forest: '#B5E4CF',
    hills: '#E2E8D0',
    mountains: '#CCCFD8',
    desert: '#FFE9C5',
    forestInk: '#67AE92',
    hillInk: '#969F7F',
    mountainInk: '#7D818F',
    desertInk: '#D8AF7E',
  },
];

/** Толщина линий узоров, экранные px — кандидат в токен map.patternWidth. */
export const PATTERN_WIDTH_CANDIDATE = 1.25;
