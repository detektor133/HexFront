// Названия государств и городов на языке игрока. Симуляция хранит код (`~n:<государство>:<номер>`,
// `~g:<начало>:<окончание>`, `~b:<государство>:<круг>` у бота), а слово подставляется здесь:
// один и тот же матч на русском и английском показывает правильные названия каждому.
// Название, которое игрок ввёл сам, не код и показывается как есть. Бот всегда подчёркнут:
// к каждой букве добавлен знак «нижняя черта» (U+0332), он работает и в HTML, и в тексте карты.
import { GEN_PREFIX_COUNT, GEN_SUFFIX_COUNT, NATION_CITY_COUNT, NATION_COUNT } from '@hexfront/sim';

import { lang } from './dict.ts';

/** Государство: название и список городов через запятую (первая — столица). */
type NationRow = readonly [name: string, cities: string];

const NATIONS_RU: readonly NationRow[] = [
  [
    'Российская империя',
    'Москва, Санкт-Петербург, Новгород, Казань, Смоленск, Тверь, Псков, Ярославль, Нижний Новгород, Рязань, Воронеж, Тула',
  ],
  [
    'Османская империя',
    'Стамбул, Бурса, Эдирне, Анкара, Конья, Измир, Трабзон, Сивас, Багдад, Дамаск, Мосул, Алеппо',
  ],
  [
    'Британская империя',
    'Лондон, Ливерпуль, Манчестер, Бристоль, Йорк, Эдинбург, Кардифф, Оксфорд, Кембридж, Дувр, Бат, Честер',
  ],
  [
    'Французская империя',
    'Париж, Лион, Марсель, Бордо, Руан, Тулуза, Лилль, Нант, Реймс, Страсбург, Кале, Дижон',
  ],
  [
    'Германская империя',
    'Берлин, Гамбург, Мюнхен, Кёльн, Дрезден, Лейпциг, Бремен, Франкфурт, Штутгарт, Кёнигсберг, Ганновер, Нюрнберг',
  ],
  [
    'Австро-Венгрия',
    'Вена, Будапешт, Прага, Краков, Грац, Зальцбург, Триест, Брно, Львов, Загреб, Линц, Инсбрук',
  ],
  [
    'Испанская империя',
    'Мадрид, Севилья, Барселона, Валенсия, Толедо, Гранада, Бильбао, Малага, Сарагоса, Кордова, Кадис, Саламанка',
  ],
  [
    'Японская империя',
    'Токио, Киото, Осака, Нагоя, Хиросима, Нара, Сэндай, Фукуока, Нагасаки, Саппоро, Кобе, Ниигата',
  ],
  [
    'Империя Цин',
    'Пекин, Нанкин, Шанхай, Сиань, Ухань, Чэнду, Гуанчжоу, Ханчжоу, Тяньцзинь, Мукден, Харбин, Чунцин',
  ],
  [
    'Персидская империя',
    'Исфахан, Тегеран, Шираз, Тебриз, Мешхед, Керман, Хамадан, Йезд, Рашт, Персеполь, Абадан, Бушир',
  ],
  [
    'Римская империя',
    'Рим, Равенна, Милан, Неаполь, Капуя, Верона, Генуя, Пиза, Турин, Бари, Анкона, Тарент',
  ],
  [
    'Шведская империя',
    'Стокгольм, Гётеборг, Уппсала, Мальмё, Лунд, Эребру, Норрчёпинг, Лулео, Евле, Карлскруна, Карлстад, Кальмар',
  ],
  [
    'Португальская империя',
    'Лиссабон, Порту, Коимбра, Брага, Фару, Эвора, Синтра, Визеу, Гимарайнш, Сетубал, Авейру, Лагуш',
  ],
  [
    'Нидерландская империя',
    'Амстердам, Роттердам, Гаага, Утрехт, Гронинген, Эйндховен, Харлем, Лейден, Бреда, Неймеген, Делфт, Маастрихт',
  ],
  [
    'Речь Посполитая',
    'Варшава, Краков, Вильнюс, Гданьск, Познань, Люблин, Каунас, Вроцлав, Торунь, Лодзь, Гродно, Минск',
  ],
  [
    'Египетское царство',
    'Каир, Александрия, Луксор, Асуан, Мемфис, Фивы, Гиза, Танта, Порт-Саид, Суэц, Асьют, Миния',
  ],
  [
    'Империя Великих Моголов',
    'Дели, Агра, Лахор, Джайпур, Лакхнау, Патна, Ахмадабад, Хайдарабад, Бхопал, Варанаси, Мултан, Дакка',
  ],
  [
    'Монгольская империя',
    'Каракорум, Ханбалык, Сарай, Бухара, Самарканд, Ургенч, Кашгар, Алмалык, Улан-Батор, Хух-Хото, Чойбалсан, Эрдэнэт',
  ],
  [
    'Эфиопская империя',
    'Аддис-Абеба, Аксум, Гондар, Лалибела, Хараре, Дыре-Дава, Мекеле, Джимма, Бахр-Дар, Дессе, Адама, Аваса',
  ],
  [
    'Империя Мали',
    'Томбукту, Гао, Дженне, Ниани, Сегу, Бамако, Мопти, Кайес, Сикасо, Кутиала, Кидаль, Тессалит',
  ],
  [
    'Империя инков',
    'Куско, Мачу-Пикчу, Кито, Ла-Пас, Арекипа, Трухильо, Пуно, Хуанкайо, Кахамарка, Тумбес, Ика, Чиклайо',
  ],
  [
    'Империя ацтеков',
    'Теночтитлан, Тескоко, Тлакопан, Чолула, Тлашкала, Куэрнавака, Оахака, Веракрус, Пуэбла, Мехико, Тула, Толука',
  ],
  [
    'Корейское королевство',
    'Сеул, Пусан, Тэгу, Инчхон, Кванджу, Тэджон, Ульсан, Сувон, Чхонджу, Чонджу, Пхеньян, Кэсон',
  ],
  [
    'Королевство Сиам',
    'Бангкок, Аюттхая, Чиангмай, Пхукет, Сукхотай, Корат, Кхонкэн, Паттайя, Лампанг, Удонтхани, Хатъяй, Ратчабури',
  ],
  [
    'Византийская империя',
    'Константинополь, Никея, Трапезунд, Салоники, Афины, Адрианополь, Эфес, Антиохия, Филадельфия, Сардис, Корфу, Патры',
  ],
  [
    'Карфагенская республика',
    'Карфаген, Утика, Гадрумет, Гиппон, Лептис, Сабрата, Тингис, Гадес, Лилибей, Панорм, Цирта, Тапс',
  ],
  [
    'Македонская империя',
    'Пелла, Эги, Амфиполь, Пидна, Дион, Бероя, Олинф, Вавилон, Сузы, Экбатана, Бактры, Таксила',
  ],
  [
    'Датское королевство',
    'Копенгаген, Орхус, Оденсе, Ольборг, Роскилле, Рибе, Хельсингёр, Эсбьерг, Рандерс, Колдинг, Вайле, Силькеборг',
  ],
  [
    'Норвежское королевство',
    'Осло, Берген, Тронхейм, Ставангер, Тромсё, Драммен, Фредрикстад, Кристиансанн, Бодё, Олесунн, Хамар, Лиллехаммер',
  ],
  [
    'Венецианская республика',
    'Венеция, Падуя, Виченца, Тревизо, Брешиа, Бергамо, Удине, Задар, Сплит, Котор, Кандия, Модон',
  ],
];

const NATIONS_EN: readonly NationRow[] = [
  [
    'Russian Empire',
    'Moscow, Saint Petersburg, Novgorod, Kazan, Smolensk, Tver, Pskov, Yaroslavl, Nizhny Novgorod, Ryazan, Voronezh, Tula',
  ],
  [
    'Ottoman Empire',
    'Istanbul, Bursa, Edirne, Ankara, Konya, Izmir, Trabzon, Sivas, Baghdad, Damascus, Mosul, Aleppo',
  ],
  [
    'British Empire',
    'London, Liverpool, Manchester, Bristol, York, Edinburgh, Cardiff, Oxford, Cambridge, Dover, Bath, Chester',
  ],
  [
    'French Empire',
    'Paris, Lyon, Marseille, Bordeaux, Rouen, Toulouse, Lille, Nantes, Reims, Strasbourg, Calais, Dijon',
  ],
  [
    'German Empire',
    'Berlin, Hamburg, Munich, Cologne, Dresden, Leipzig, Bremen, Frankfurt, Stuttgart, Konigsberg, Hanover, Nuremberg',
  ],
  [
    'Austria-Hungary',
    'Vienna, Budapest, Prague, Krakow, Graz, Salzburg, Trieste, Brno, Lviv, Zagreb, Linz, Innsbruck',
  ],
  [
    'Spanish Empire',
    'Madrid, Seville, Barcelona, Valencia, Toledo, Granada, Bilbao, Malaga, Zaragoza, Cordoba, Cadiz, Salamanca',
  ],
  [
    'Japanese Empire',
    'Tokyo, Kyoto, Osaka, Nagoya, Hiroshima, Nara, Sendai, Fukuoka, Nagasaki, Sapporo, Kobe, Niigata',
  ],
  [
    'Qing Empire',
    'Beijing, Nanjing, Shanghai, Xian, Wuhan, Chengdu, Guangzhou, Hangzhou, Tianjin, Mukden, Harbin, Chongqing',
  ],
  [
    'Persian Empire',
    'Isfahan, Tehran, Shiraz, Tabriz, Mashhad, Kerman, Hamadan, Yazd, Rasht, Persepolis, Abadan, Bushehr',
  ],
  [
    'Roman Empire',
    'Rome, Ravenna, Milan, Naples, Capua, Verona, Genoa, Pisa, Turin, Bari, Ancona, Tarentum',
  ],
  [
    'Swedish Empire',
    'Stockholm, Gothenburg, Uppsala, Malmo, Lund, Orebro, Norrkoping, Lulea, Gavle, Karlskrona, Karlstad, Kalmar',
  ],
  [
    'Portuguese Empire',
    'Lisbon, Porto, Coimbra, Braga, Faro, Evora, Sintra, Viseu, Guimaraes, Setubal, Aveiro, Lagos',
  ],
  [
    'Dutch Empire',
    'Amsterdam, Rotterdam, The Hague, Utrecht, Groningen, Eindhoven, Haarlem, Leiden, Breda, Nijmegen, Delft, Maastricht',
  ],
  [
    'Polish-Lithuanian Commonwealth',
    'Warsaw, Krakow, Vilnius, Gdansk, Poznan, Lublin, Kaunas, Wroclaw, Torun, Lodz, Grodno, Minsk',
  ],
  [
    'Egyptian Kingdom',
    'Cairo, Alexandria, Luxor, Aswan, Memphis, Thebes, Giza, Tanta, Port Said, Suez, Asyut, Minya',
  ],
  [
    'Mughal Empire',
    'Delhi, Agra, Lahore, Jaipur, Lucknow, Patna, Ahmedabad, Hyderabad, Bhopal, Varanasi, Multan, Dhaka',
  ],
  [
    'Mongol Empire',
    'Karakorum, Khanbaliq, Sarai, Bukhara, Samarkand, Urgench, Kashgar, Almalik, Ulaanbaatar, Hohhot, Choibalsan, Erdenet',
  ],
  [
    'Ethiopian Empire',
    'Addis Ababa, Axum, Gondar, Lalibela, Harar, Dire Dawa, Mekelle, Jimma, Bahir Dar, Dessie, Adama, Awasa',
  ],
  [
    'Mali Empire',
    'Timbuktu, Gao, Djenne, Niani, Segou, Bamako, Mopti, Kayes, Sikasso, Koutiala, Kidal, Tessalit',
  ],
  [
    'Inca Empire',
    'Cusco, Machu Picchu, Quito, La Paz, Arequipa, Trujillo, Puno, Huancayo, Cajamarca, Tumbes, Ica, Chiclayo',
  ],
  [
    'Aztec Empire',
    'Tenochtitlan, Texcoco, Tlacopan, Cholula, Tlaxcala, Cuernavaca, Oaxaca, Veracruz, Puebla, Mexico City, Tula, Toluca',
  ],
  [
    'Korean Kingdom',
    'Seoul, Busan, Daegu, Incheon, Gwangju, Daejeon, Ulsan, Suwon, Cheongju, Jeonju, Pyongyang, Kaesong',
  ],
  [
    'Kingdom of Siam',
    'Bangkok, Ayutthaya, Chiang Mai, Phuket, Sukhothai, Korat, Khon Kaen, Pattaya, Lampang, Udon Thani, Hat Yai, Ratchaburi',
  ],
  [
    'Byzantine Empire',
    'Constantinople, Nicaea, Trebizond, Thessaloniki, Athens, Adrianople, Ephesus, Antioch, Philadelphia, Sardis, Corfu, Patras',
  ],
  [
    'Carthaginian Republic',
    'Carthage, Utica, Hadrumetum, Hippo, Leptis, Sabratha, Tingis, Gades, Lilybaeum, Panormus, Cirta, Thapsus',
  ],
  [
    'Macedonian Empire',
    'Pella, Aigai, Amphipolis, Pydna, Dion, Beroea, Olynthus, Babylon, Susa, Ecbatana, Bactra, Taxila',
  ],
  [
    'Danish Kingdom',
    'Copenhagen, Aarhus, Odense, Aalborg, Roskilde, Ribe, Helsingor, Esbjerg, Randers, Kolding, Vejle, Silkeborg',
  ],
  [
    'Norwegian Kingdom',
    'Oslo, Bergen, Trondheim, Stavanger, Tromso, Drammen, Fredrikstad, Kristiansand, Bodo, Alesund, Hamar, Lillehammer',
  ],
  [
    'Venetian Republic',
    'Venice, Padua, Vicenza, Treviso, Brescia, Bergamo, Udine, Zadar, Split, Kotor, Candia, Modon',
  ],
];

/** Составное название: начало слова + окончание, без согласования по родам («Бело» + «горск»). */
const PREFIXES_RU =
  'Бело Красно Ново Старо Зелено Черно Золото Серебро Сосно Дубо Берёзо Ольхо Липо Орло Волко Медведо Лесо Речно Озёрно Морско Ясно Светло Тихо Каменно Звездо Ветро Грозо Лисо Кедро Рябино Малино Железо'.split(
    ' ',
  );
const SUFFIXES_RU =
  'град горск борск поле мост яр брод холм лог дол ключ острог луг вод речье озёрск гай гора склон залив мыс хутор вал дар'.split(
    ' ',
  );
const PREFIXES_EN =
  'Stone Red New Old Green Black Gold Silver Oak Pine Birch Ash Elm Wolf Bear Eagle Fox Wind Storm Iron Salt Swan Mist Bright Hawk Raven Frost Sun Moon Star Thorn Cliff'.split(
    ' ',
  );
const SUFFIXES_EN =
  'ford ton bridge haven field wick gate ham bury port mouth dale wood stead hill ley worth by wall stone side minster crest vale'.split(
    ' ',
  );

interface Nation {
  readonly name: string;
  readonly cities: readonly string[];
}

const parse = (rows: readonly NationRow[]): readonly Nation[] =>
  rows.map(([name, cities]) => ({ name, cities: cities.split(', ') }));

const NATIONS_RU_PARSED = parse(NATIONS_RU);
const NATIONS_EN_PARSED = parse(NATIONS_EN);
const NATIONS = lang === 'ru' ? NATIONS_RU_PARSED : NATIONS_EN_PARSED;
const PREFIXES = lang === 'ru' ? PREFIXES_RU : PREFIXES_EN;
const SUFFIXES = lang === 'ru' ? SUFFIXES_RU : SUFFIXES_EN;

/** Размеры таблиц должны совпадать с числами симуляции: иначе код укажет на несуществующее слово. */
export const NAME_TABLES_OK =
  NATIONS_RU_PARSED.length === NATION_COUNT &&
  NATIONS_EN_PARSED.length === NATION_COUNT &&
  [...NATIONS_RU_PARSED, ...NATIONS_EN_PARSED].every(
    (n) => n.cities.length === NATION_CITY_COUNT,
  ) &&
  PREFIXES_RU.length === GEN_PREFIX_COUNT &&
  PREFIXES_EN.length === GEN_PREFIX_COUNT &&
  SUFFIXES_RU.length === GEN_SUFFIX_COUNT &&
  SUFFIXES_EN.length === GEN_SUFFIX_COUNT;

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII'];

/** Знак «нижняя черта» после каждой буквы: подчёркнутое слово в любом тексте, включая холст карты. */
const LOW_LINE = '̲';

/** Подчёркивает все буквы строки (так отличаются боты). */
export function underlined(text: string): string {
  return Array.from(text, (ch) => `${ch}${LOW_LINE}`).join('');
}

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
 * Название на языке игрока: код расшифровывается, обычный текст остаётся как есть; имя бота подчёркнуто.
 * @returns готовая строка; для неизвестного кода — он сам
 */
export function localName(raw: string): string {
  if (!isNameCode(raw)) return raw;
  const [a = 0, b = 0] = parts(raw);
  const kind = raw[1];
  if (kind === 'b') return underlined(`${NATIONS[a]?.name ?? raw}${ROMAN[b] ?? ''}`);
  if (kind === 'n') return NATIONS[a]?.cities[b] ?? raw;
  if (kind === 'g') return `${PREFIXES[a] ?? ''}${SUFFIXES[b] ?? ''}`;
  return raw;
}

/** Подпись государства на карте: то же имя, что и в списках (у бота подчёркнуто). */
export const territoryName = localName;
