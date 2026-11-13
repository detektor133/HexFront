// Регионы реальной географии для карт Hexfront: рамка, число игроков и ручные правки сетки.
// Координаты правок — [широта, долгота] в градусах (WGS84).

/** Точка [широта, долгота]. */
export type LatLon = readonly [lat: number, lon: number];

export interface Region {
  /** Идентификатор карты: имя файла `maps/<id>.json` и значение `?map=`. */
  readonly id: string;
  readonly bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  /** Примерное число гексов сетки. */
  readonly hexes: number;
  /** Число спавнов (максимум игроков). */
  readonly players: number;
  /** Сид выбора городов и дорог. */
  readonly seed: number;
  /** Красить ли пустыни по слою Natural Earth `Desert`. */
  readonly desert: boolean;
  /** Дополнительные слои рек: имя файла Natural Earth и допустимые `scalerank`. */
  readonly extraRivers: readonly { layer: string; ranks: readonly string[] }[];
  /** Ломаные, вдоль которых гексы принудительно становятся водой (узкие проливы). */
  readonly strait: readonly (readonly LatLon[])[];
  /** Ломаные, вдоль которых гексы принудительно становятся сушей (перешейки, мосты, тоннели). */
  readonly link: readonly (readonly LatLon[])[];
}

const MARMARA: readonly LatLon[] = [
  [41.1, 29.05],
  [40.85, 28.7],
  [40.72, 28.0],
  [40.62, 27.3],
  [40.4, 26.75],
  [40.2, 26.4],
  [40.0, 26.15],
];
const BOSPHORUS: readonly LatLon[] = [
  [41.3, 29.12],
  [41.1, 29.05],
];
const KERCH: readonly LatLon[] = [
  [45.45, 36.6],
  [45.0, 36.7],
];
const GIBRALTAR: readonly LatLon[] = [
  [35.9, -6.0],
  [35.9, -5.2],
];

const PEREKOP: readonly LatLon[] = [
  [46.4, 33.65],
  [45.95, 33.7],
];
const CHANNEL_TUNNEL: readonly LatLon[] = [
  [51.1, 1.1],
  [50.93, 1.85],
];
const HOLYHEAD: readonly LatLon[] = [
  [53.3, -4.6],
  [53.35, -6.2],
];
const OERESUND: readonly LatLon[] = [
  [55.68, 12.6],
  [55.6, 13.0],
];
const GREAT_BELT: readonly LatLon[] = [
  [55.33, 11.14],
  [55.3, 10.79],
];
const LITTLE_BELT: readonly LatLon[] = [
  [55.5, 9.73],
  [55.57, 9.75],
];
const MESSINA: readonly LatLon[] = [
  [38.11, 15.65],
  [38.2, 15.55],
];

const MAP_EUROPE: Region = {
  id: 'europe',
  bounds: { minLon: -11, maxLon: 40, minLat: 35, maxLat: 71 },
  hexes: 10_500,
  players: 30,
  seed: 42,
  desert: false,
  extraRivers: [],
  strait: [BOSPHORUS, MARMARA, KERCH, GIBRALTAR],
  link: [PEREKOP, CHANNEL_TUNNEL, HOLYHEAD, OERESUND, GREAT_BELT, LITTLE_BELT, MESSINA],
};

const MAP_MEDITERRANEAN: Region = {
  id: 'mediterranean',
  bounds: { minLon: -10, maxLon: 37, minLat: 30, maxLat: 46 },
  hexes: 8000,
  players: 16,
  seed: 7,
  desert: true,
  extraRivers: [],
  // Босфор не прорезан: стамбульские мосты соединяют Европу и Малую Азию.
  strait: [MARMARA.slice(1), GIBRALTAR],
  link: [MESSINA, PEREKOP],
};

const MAP_NORTH: Region = {
  id: 'north',
  bounds: { minLon: -11, maxLon: 32, minLat: 49.5, maxLat: 71 },
  hexes: 8000,
  players: 14,
  seed: 11,
  desert: false,
  extraRivers: [],
  strait: [],
  link: [CHANNEL_TUNNEL, HOLYHEAD, OERESUND, GREAT_BELT, LITTLE_BELT],
};

const MAP_NAMERICA: Region = {
  id: 'namerica',
  bounds: { minLon: -100, maxLon: -60, minLat: 25, maxLat: 50 },
  hexes: 9000,
  players: 16,
  seed: 5,
  desert: true,
  extraRivers: [],
  strait: [],
  // Мост Макино соединяет полуострова Мичигана.
  link: [
    [
      [45.78, -84.73],
      [45.86, -84.73],
    ],
  ],
};

const MAP_JAPAN: Region = {
  id: 'japan',
  bounds: { minLon: 128, maxLon: 146, minLat: 30, maxLat: 46 },
  hexes: 4500,
  players: 8,
  seed: 3,
  desert: false,
  extraRivers: [],
  strait: [],
  // Кандзи (Кюсю), мост Нисеки (Сикоку) и тоннель Сэйкан (Хоккайдо) соединяют острова.
  link: [
    [
      [34.0, 130.9],
      [33.92, 131.0],
    ],
    [
      [34.4, 133.2],
      [34.07, 133.0],
    ],
    [
      [41.26, 140.34],
      [41.4, 140.2],
    ],
  ],
};

const MAP_MIDEAST: Region = {
  id: 'mideast',
  bounds: { minLon: 25, maxLon: 65, minLat: 22, maxLat: 45 },
  hexes: 8000,
  players: 14,
  seed: 9,
  desert: true,
  extraRivers: [],
  strait: [MARMARA.slice(2)],
  link: [],
};

export const REGIONS: readonly Region[] = [
  MAP_EUROPE,
  MAP_MEDITERRANEAN,
  MAP_NORTH,
  MAP_NAMERICA,
  MAP_JAPAN,
  MAP_MIDEAST,
];
