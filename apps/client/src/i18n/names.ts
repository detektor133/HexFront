// Названия государств и городов на языке игрока. Симуляция хранит код (`~n:<государство>:<номер>`,
// `~g:<начало>:<окончание>`, `~b:<государство>:<круг>` у бота), а слово подставляется здесь:
// один и тот же матч на русском и английском показывает правильные названия каждому.
// Название, которое игрок ввёл сам, не код и показывается как есть.
import { GEN_PREFIX_COUNT, GEN_SUFFIX_COUNT, NATION_CITY_COUNT, NATION_COUNT } from '@hexfront/sim';

import { lang } from './dict.ts';

interface Nation {
  readonly name: string;
  /** Столица первой, дальше города по порядку основания. */
  readonly cities: readonly string[];
}

const NATIONS_RU: readonly Nation[] = [
  {
    name: 'Российская империя',
    cities: [
      'Москва',
      'Санкт-Петербург',
      'Новгород',
      'Казань',
      'Смоленск',
      'Тверь',
      'Псков',
      'Ярославль',
      'Нижний Новгород',
      'Рязань',
    ],
  },
  {
    name: 'Османская империя',
    cities: [
      'Стамбул',
      'Бурса',
      'Эдирне',
      'Анкара',
      'Конья',
      'Измир',
      'Трабзон',
      'Сивас',
      'Багдад',
      'Дамаск',
    ],
  },
  {
    name: 'Британская империя',
    cities: [
      'Лондон',
      'Ливерпуль',
      'Манчестер',
      'Бристоль',
      'Йорк',
      'Эдинбург',
      'Кардифф',
      'Оксфорд',
      'Кембридж',
      'Дувр',
    ],
  },
  {
    name: 'Французская империя',
    cities: [
      'Париж',
      'Лион',
      'Марсель',
      'Бордо',
      'Руан',
      'Тулуза',
      'Лилль',
      'Нант',
      'Реймс',
      'Страсбург',
    ],
  },
  {
    name: 'Германская империя',
    cities: [
      'Берлин',
      'Гамбург',
      'Мюнхен',
      'Кёльн',
      'Дрезден',
      'Лейпциг',
      'Бремен',
      'Франкфурт',
      'Штутгарт',
      'Кёнигсберг',
    ],
  },
  {
    name: 'Австро-Венгрия',
    cities: [
      'Вена',
      'Будапешт',
      'Прага',
      'Краков',
      'Грац',
      'Зальцбург',
      'Триест',
      'Брно',
      'Львов',
      'Загреб',
    ],
  },
  {
    name: 'Испанская империя',
    cities: [
      'Мадрид',
      'Севилья',
      'Барселона',
      'Валенсия',
      'Толедо',
      'Гранада',
      'Бильбао',
      'Малага',
      'Сарагоса',
      'Кордова',
    ],
  },
  {
    name: 'Японская империя',
    cities: [
      'Токио',
      'Киото',
      'Осака',
      'Нагоя',
      'Хиросима',
      'Нара',
      'Сэндай',
      'Фукуока',
      'Нагасаки',
      'Саппоро',
    ],
  },
  {
    name: 'Империя Цин',
    cities: [
      'Пекин',
      'Нанкин',
      'Шанхай',
      'Сиань',
      'Ухань',
      'Чэнду',
      'Гуанчжоу',
      'Ханчжоу',
      'Тяньцзинь',
      'Мукден',
    ],
  },
  {
    name: 'Персидская империя',
    cities: [
      'Исфахан',
      'Тегеран',
      'Шираз',
      'Тебриз',
      'Мешхед',
      'Керман',
      'Хамадан',
      'Йезд',
      'Рашт',
      'Персеполь',
    ],
  },
  {
    name: 'Римская империя',
    cities: [
      'Рим',
      'Равенна',
      'Милан',
      'Неаполь',
      'Капуя',
      'Верона',
      'Генуя',
      'Пиза',
      'Турин',
      'Бари',
    ],
  },
  {
    name: 'Шведская империя',
    cities: [
      'Стокгольм',
      'Гётеборг',
      'Уппсала',
      'Мальмё',
      'Лунд',
      'Эребру',
      'Норрчёпинг',
      'Лулео',
      'Евле',
      'Карлскруна',
    ],
  },
];

const NATIONS_EN: readonly Nation[] = [
  {
    name: 'Russian Empire',
    cities: [
      'Moscow',
      'Saint Petersburg',
      'Novgorod',
      'Kazan',
      'Smolensk',
      'Tver',
      'Pskov',
      'Yaroslavl',
      'Nizhny Novgorod',
      'Ryazan',
    ],
  },
  {
    name: 'Ottoman Empire',
    cities: [
      'Istanbul',
      'Bursa',
      'Edirne',
      'Ankara',
      'Konya',
      'Izmir',
      'Trabzon',
      'Sivas',
      'Baghdad',
      'Damascus',
    ],
  },
  {
    name: 'British Empire',
    cities: [
      'London',
      'Liverpool',
      'Manchester',
      'Bristol',
      'York',
      'Edinburgh',
      'Cardiff',
      'Oxford',
      'Cambridge',
      'Dover',
    ],
  },
  {
    name: 'French Empire',
    cities: [
      'Paris',
      'Lyon',
      'Marseille',
      'Bordeaux',
      'Rouen',
      'Toulouse',
      'Lille',
      'Nantes',
      'Reims',
      'Strasbourg',
    ],
  },
  {
    name: 'German Empire',
    cities: [
      'Berlin',
      'Hamburg',
      'Munich',
      'Cologne',
      'Dresden',
      'Leipzig',
      'Bremen',
      'Frankfurt',
      'Stuttgart',
      'Konigsberg',
    ],
  },
  {
    name: 'Austria-Hungary',
    cities: [
      'Vienna',
      'Budapest',
      'Prague',
      'Krakow',
      'Graz',
      'Salzburg',
      'Trieste',
      'Brno',
      'Lviv',
      'Zagreb',
    ],
  },
  {
    name: 'Spanish Empire',
    cities: [
      'Madrid',
      'Seville',
      'Barcelona',
      'Valencia',
      'Toledo',
      'Granada',
      'Bilbao',
      'Malaga',
      'Zaragoza',
      'Cordoba',
    ],
  },
  {
    name: 'Japanese Empire',
    cities: [
      'Tokyo',
      'Kyoto',
      'Osaka',
      'Nagoya',
      'Hiroshima',
      'Nara',
      'Sendai',
      'Fukuoka',
      'Nagasaki',
      'Sapporo',
    ],
  },
  {
    name: 'Qing Empire',
    cities: [
      'Beijing',
      'Nanjing',
      'Shanghai',
      'Xian',
      'Wuhan',
      'Chengdu',
      'Guangzhou',
      'Hangzhou',
      'Tianjin',
      'Mukden',
    ],
  },
  {
    name: 'Persian Empire',
    cities: [
      'Isfahan',
      'Tehran',
      'Shiraz',
      'Tabriz',
      'Mashhad',
      'Kerman',
      'Hamadan',
      'Yazd',
      'Rasht',
      'Persepolis',
    ],
  },
  {
    name: 'Roman Empire',
    cities: [
      'Rome',
      'Ravenna',
      'Milan',
      'Naples',
      'Capua',
      'Verona',
      'Genoa',
      'Pisa',
      'Turin',
      'Bari',
    ],
  },
  {
    name: 'Swedish Empire',
    cities: [
      'Stockholm',
      'Gothenburg',
      'Uppsala',
      'Malmo',
      'Lund',
      'Orebro',
      'Norrkoping',
      'Lulea',
      'Gavle',
      'Karlskrona',
    ],
  },
];

/** Составное название: начало слова + окончание, без согласования по родам («Бело» + «горск»). */
const PREFIXES_RU: readonly string[] = [
  'Бело',
  'Красно',
  'Ново',
  'Старо',
  'Зелено',
  'Черно',
  'Золото',
  'Серебро',
  'Сосно',
  'Дубо',
  'Берёзо',
  'Ольхо',
  'Липо',
  'Орло',
  'Волко',
  'Медведо',
  'Лесо',
  'Речно',
  'Озёрно',
  'Морско',
  'Ясно',
  'Светло',
  'Тихо',
  'Каменно',
];
const SUFFIXES_RU: readonly string[] = [
  'град',
  'горск',
  'борск',
  'поле',
  'мост',
  'яр',
  'брод',
  'холм',
  'лог',
  'дол',
  'ключ',
  'острог',
  'луг',
  'вод',
  'речье',
  'озёрск',
];
const PREFIXES_EN: readonly string[] = [
  'Stone',
  'Red',
  'New',
  'Old',
  'Green',
  'Black',
  'Gold',
  'Silver',
  'Oak',
  'Pine',
  'Birch',
  'Ash',
  'Elm',
  'Wolf',
  'Bear',
  'Eagle',
  'Fox',
  'Wind',
  'Storm',
  'Iron',
  'Salt',
  'Swan',
  'Mist',
  'Bright',
];
const SUFFIXES_EN: readonly string[] = [
  'ford',
  'ton',
  'bridge',
  'haven',
  'field',
  'wick',
  'gate',
  'ham',
  'bury',
  'port',
  'mouth',
  'dale',
  'wood',
  'stead',
  'hill',
  'ley',
];

const NATIONS = lang === 'ru' ? NATIONS_RU : NATIONS_EN;
const PREFIXES = lang === 'ru' ? PREFIXES_RU : PREFIXES_EN;
const SUFFIXES = lang === 'ru' ? SUFFIXES_RU : SUFFIXES_EN;

/** Размеры таблиц должны совпадать с числами симуляции: иначе код укажет на несуществующее слово. */
export const NAME_TABLES_OK =
  NATIONS_RU.length === NATION_COUNT &&
  NATIONS_EN.length === NATION_COUNT &&
  [...NATIONS_RU, ...NATIONS_EN].every((n) => n.cities.length === NATION_CITY_COUNT) &&
  PREFIXES_RU.length === GEN_PREFIX_COUNT &&
  PREFIXES_EN.length === GEN_PREFIX_COUNT &&
  SUFFIXES_RU.length === GEN_SUFFIX_COUNT &&
  SUFFIXES_EN.length === GEN_SUFFIX_COUNT;

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI'];

function parts(raw: string): number[] {
  return raw
    .slice(3)
    .split(':')
    .map((p) => Number(p));
}

/** Код ли это названия (а не текст, который ввёл игрок). */
export function isNameCode(raw: string): boolean {
  return raw.startsWith('~') && raw.length > 3 && raw[2] === ':';
}

/** Бот ли игрок с таким названием. */
export function isBotName(raw: string): boolean {
  return raw.startsWith('~b:');
}

/**
 * Название на языке игрока: код расшифровывается, обычный текст остаётся как есть.
 * @returns готовая строка; для неизвестного кода — он сам
 */
export function localName(raw: string): string {
  if (!isNameCode(raw)) return raw;
  const [a = 0, b = 0] = parts(raw);
  const kind = raw[1];
  if (kind === 'b') return `${NATIONS[a]?.name ?? raw}${ROMAN[b] ?? ''}`;
  if (kind === 'n') return NATIONS[a]?.cities[b] ?? raw;
  if (kind === 'g') return `${PREFIXES[a] ?? ''}${SUFFIXES[b] ?? ''}`;
  return raw;
}

/** Подпись государства на карте: у бота после названия стоит «_», чтобы издали отличать от людей. */
export function territoryName(raw: string): string {
  const text = localName(raw);
  return isBotName(raw) ? `${text}_` : text;
}
