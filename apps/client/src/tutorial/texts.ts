// Тексты обучения. Шаг — заголовок, текст и подсказка управления отдельно для пальца и мыши:
// ключ `<глава>.<шаг>`, у шагов с жестами есть варианты `touch` и `mouse`.
import type { ChapterId } from './script.ts';
import { lang } from '../i18n/dict.ts';

interface Copy {
  readonly title: string;
  readonly text: string;
  readonly touch?: string;
  readonly mouse?: string;
}

type Both = { readonly ru: Copy; readonly en: Copy };

const TEXTS: Readonly<Record<string, Both>> = {
  'core.pan': {
    ru: {
      title: 'Двигай карту',
      text: 'Карта больше экрана. Посмотри, что вокруг.',
      touch: 'Потяни карту одним пальцем за пустое место.',
      mouse: 'Зажми правую кнопку мыши на пустом месте и потяни.',
    },
    en: {
      title: 'Move the map',
      text: 'The map is bigger than the screen. Look around.',
      touch: 'Drag the map with one finger on an empty spot.',
      mouse: 'Hold the right mouse button on an empty spot and drag.',
    },
  },
  'core.zoom': {
    ru: {
      title: 'Масштаб',
      text: 'Приблизь карту, чтобы разглядеть отряды, и отдали, чтобы увидеть страну целиком.',
      touch: 'Разведи или сведи два пальца.',
      mouse: 'Покрути колесо мыши.',
    },
    en: {
      title: 'Zoom',
      text: 'Zoom in to see units, zoom out to see the whole country.',
      touch: 'Pinch with two fingers.',
      mouse: 'Use the mouse wheel.',
    },
  },
  'core.select': {
    ru: {
      title: 'Выбери отряд',
      text: 'Твои войска стоят на карте фишками. Выбери фишку на подсвеченном гексе.',
      touch: 'Коснись фишки.',
      mouse: 'Нажми левую кнопку мыши на фишке.',
    },
    en: {
      title: 'Select a unit',
      text: 'Your troops stand on the map as chips. Pick the chip on the marked hex.',
      touch: 'Tap the chip.',
      mouse: 'Left-click the chip.',
    },
  },
  'core.move': {
    ru: {
      title: 'Отдай приказ',
      text: 'Выбранные отряды можно послать на любой гекс: они дойдут и займут землю. Выбор и приказ разделены, чтобы случайное касание не двигало войска.',
      touch: 'Удерживай палец на подсвеченном гексе и отпусти.',
      mouse: 'Нажми правую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'Give an order',
      text: 'Selected units can go to any hex and take the land. Selecting and ordering are separate, so a stray touch never moves troops.',
      touch: 'Press and hold on the marked hex, then release.',
      mouse: 'Right-click the marked hex.',
    },
  },
  'core.deselect': {
    ru: {
      title: 'Сними выбор',
      text: 'Пока выбран отряд, нажатие по земле не открывает меню. Нажми на свою пустую землю или клавишу Esc — выбор снимется.',
      touch: 'Коснись подсвеченной своей земли без фишек.',
      mouse: 'Нажми Esc или левой кнопкой на свою пустую землю.',
    },
    en: {
      title: 'Clear the selection',
      text: 'While a unit is selected, pressing land does not open the menu. Press your own empty land or Esc to clear the selection.',
      touch: 'Tap your own land without chips.',
      mouse: 'Press Esc or left-click your own empty land.',
    },
  },
  'core.economy': {
    ru: {
      title: 'Люди и золото',
      text: 'Народ растёт на твоей земле: из него набираются солдаты и появляются города. Золото идёт от налога и тратится на стройку и армию.',
    },
    en: {
      title: 'People and gold',
      text: 'People grow on your land: soldiers and cities come from them. Gold comes from tax and pays for buildings and the army.',
    },
  },
  'core.menu': {
    ru: {
      title: 'Меню земли',
      text: 'Приказы целой армии отдаются через меню земли: нажми на ничью землю без выбранных отрядов. Если отряды ещё выбраны, первое нажатие снимет выбор.',
      touch: 'Коснись подсвеченного гекса.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'Land menu',
      text: 'Orders for a whole army go through the land menu: press neutral land with no units selected. If units are still selected, the first press clears the selection.',
      touch: 'Tap the marked hex.',
      mouse: 'Left-click the marked hex.',
    },
  },
  'core.occupy': {
    ru: {
      title: 'Занять землю',
      text: 'Нажми «Занять»: ближайшая свободная армия сама разойдётся по ничьей земле и захватит её вокруг. Под кнопкой видно, какая армия получит приказ.',
    },
    en: {
      title: 'Occupy land',
      text: 'Press Occupy: the nearest free army spreads over neutral land and takes it. Under the button you can see which army gets the order.',
    },
  },
  'core.tax': {
    ru: {
      title: 'Налог',
      text: 'Налог даёт золото, но замедляет рост людей. Открой налог и подвинь ползунок: внутри видно, что изменится.',
      touch: 'Коснись значка налога.',
      mouse: 'Нажми на значок налога.',
    },
    en: {
      title: 'Tax',
      text: 'Tax brings gold but slows population growth. Open it and move the slider: it shows what will change.',
      touch: 'Tap the tax icon.',
      mouse: 'Click the tax icon.',
    },
  },
  'core.wait': {
    ru: {
      title: 'Подожди людей',
      text: 'Город нельзя основать, пока на гексе мало людей. Полоса показывает, сколько набралось: дай стране вырасти.',
    },
    en: {
      title: 'Wait for people',
      text: 'A city cannot be founded until the hex has enough people. The bar shows how many there are: let the country grow.',
    },
  },
  'core.city': {
    ru: {
      title: 'Основать город',
      text: 'Города дают людей, золото и снабжение. Нажми на подсвеченный гекс своей земли и выбери «Основать город»: рядом с ним сам проложится дорога к столице.',
      touch: 'Коснись гекса и нажми кнопку города в карточке.',
      mouse: 'Нажми на гекс левой кнопкой и выбери кнопку города в карточке.',
    },
    en: {
      title: 'Found a city',
      text: 'Cities give people, gold and supply. Select the marked hex of your land and press Found a city: a road to the capital is laid automatically.',
      touch: 'Tap the hex, then the city button in the card.',
      mouse: 'Left-click the hex, then the city button in the card.',
    },
  },
  'core.supplyMode': {
    ru: {
      title: 'Карта снабжения',
      text: 'Включи карту снабжения: каждый гекс окрашен от красного (нет снабжения) до зелёного (полное). Склад и дорога сдвинут зелёный к границе.',
      touch: 'Коснись значка карты снабжения.',
      mouse: 'Нажми значок карты снабжения.',
    },
    en: {
      title: 'Supply map',
      text: 'Turn on the supply map: each hex is coloured from red (no supply) to green (full). A depot and a road move the green toward the border.',
      touch: 'Tap the supply map icon.',
      mouse: 'Click the supply map icon.',
    },
  },
  'core.hammer': {
    ru: {
      title: 'Режим строительства',
      text: 'Молоточек открывает ряд построек: город, склад, укрепление, благоустройство и дорога. Включи его.',
    },
    en: {
      title: 'Build mode',
      text: 'The hammer opens a row of buildings: city, depot, fort, improvement and road. Turn it on.',
    },
  },
  'core.depotTool': {
    ru: {
      title: 'Склад',
      text: 'Склад — узел снабжения: от него армия получает боеприпасы и провиант. Выбери склад, подсвечены гексы, где его можно поставить.',
    },
    en: {
      title: 'Depot',
      text: 'A depot is a supply node: the army gets ammo and food from it. Choose the depot; the hexes where it can be placed are highlighted.',
    },
  },
  'core.depot': {
    ru: {
      title: 'Поставь склад',
      text: 'Поставь склад на подсвеченный гекс ближе к границе с врагом: так снабжение дотянется до фронта. Склад сам просит дорогу к основной сети.',
      touch: 'Коснись подсвеченного гекса.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'Place a depot',
      text: 'Place a depot on a highlighted hex closer to the enemy border so supply reaches the front. A depot asks for a road to the main network by itself.',
      touch: 'Tap a highlighted hex.',
      mouse: 'Left-click a highlighted hex.',
    },
  },
  'core.roadTool': {
    ru: {
      title: 'Дорога вручную',
      text: 'Дороги прокладываются сами, но иногда нужен свой маршрут между городами и складами. Выбери инструмент «Дорога».',
    },
    en: {
      title: 'A road by hand',
      text: 'Roads are laid along the shortest path, but sometimes you need your own route. Choose the Road tool next to the depot.',
    },
  },
  'core.road': {
    ru: {
      title: 'Проложи дорогу',
      text: 'Нажми свой город или склад — начало, затем (по желанию) гексы своей земли, чтобы изогнуть путь, и в конце другой свой город или склад: дорога проложится. Цена и ошибки видны в карточке строительства.',
      touch: 'Касайся точек по порядку.',
      mouse: 'Нажимай левой кнопкой точки по порядку.',
    },
    en: {
      title: 'Lay the road',
      text: 'Click your city or depot to start, then (optionally) hexes of your land to bend the path, and finally another city or depot: the road is laid. The price and errors are in the build card.',
      touch: 'Tap the points in order.',
      mouse: 'Left-click the points in order.',
    },
  },
  'core.armyPick': {
    ru: {
      title: 'Выбери армию',
      text: 'Нажми на карточку армии: появятся её приказы, а на карте подсветятся её отряды.',
      touch: 'Коснись карточки армии.',
      mouse: 'Нажми левой кнопкой на карточку армии.',
    },
    en: {
      title: 'Select the army',
      text: 'Press the army card: its orders appear and its units are highlighted on the map.',
      touch: 'Tap the army card.',
      mouse: 'Left-click the army card.',
    },
  },
  'core.armyPlus': {
    ru: {
      title: 'Усили армию',
      text: 'Кнопка «+» увеличивает армию на выбранную долю, под ней — цена докупки солдат. Стрелка рядом меняет шаг. Доведи армию примерно до 400 солдат: нажимай «+» или выбери шаг побольше.',
    },
    en: {
      title: 'Strengthen the army',
      text: 'The + button grows the army by the chosen share; the price of the extra soldiers is under it. The arrow next to it changes the step. Bring the army to about 400 soldiers: press + or pick a bigger step.',
    },
  },
  'core.recruit': {
    ru: {
      title: 'Набор войск',
      text: 'Солдаты набираются из людей за золото и приходят в армию. Подожди, пока полоса дойдёт до конца.',
    },
    en: {
      title: 'Recruitment',
      text: 'Soldiers are recruited from people for gold and join the army. Wait until the bar fills up.',
    },
  },
  'core.enemy': {
    ru: {
      title: 'Соперник',
      text: 'Вот земля соперника. Нажми на неё без выбранных отрядов: откроется меню страны с дипломатией и приказами армии.',
      touch: 'Коснись подсвеченного гекса.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'The rival',
      text: 'This is the rival’s land. Press it with no units selected: the country menu opens with diplomacy and army orders.',
      touch: 'Tap the marked hex.',
      mouse: 'Left-click the marked hex.',
    },
  },
  'core.hold': {
    ru: {
      title: 'Держи границу',
      text: 'Нажми «Держать»: армия встанет фронтом вдоль границы с соперником и распределит отряды по ней. Если армии нет, нужное число солдат наберётся заново. Соперник заметил это и начал укрепляться.',
    },
    en: {
      title: 'Hold the border',
      text: 'Press Hold: the army forms a front along the rival’s border and spreads its units. If there is no army, the soldiers are recruited anew. The rival noticed and began to dig in.',
    },
  },
  'core.front': {
    ru: {
      title: 'Армия идёт к фронту',
      text: 'Отряды идут по своей земле к границе. Полоса показывает, как близко армия.',
    },
    en: {
      title: 'The army marches to the front',
      text: 'Units march across your land to the border. The bar shows how close the army is.',
    },
  },
  'core.supplyFront': {
    ru: {
      title: 'Снабжение фронта',
      text: 'Посмотри на полоску снабжения у отряда на границе: нужно, чтобы она была не пустой. Если пуста, дострой склад или дорогу ближе к фронту (молоточек → склад / дорога) и подожди: армия без снабжения проиграет бой.',
    },
    en: {
      title: 'Front supply',
      text: 'Look at the supply bar of the unit at the border: it must not be empty. If it is, finish a depot or road closer to the front (hammer → depot / road) and wait: an army without supply loses the fight.',
    },
  },
  'core.war': {
    ru: {
      title: 'Объяви войну',
      text: 'Пока мир, нападать нельзя. Открой меню соперника и объяви войну: с этого момента армия сможет наступать.',
    },
    en: {
      title: 'Declare war',
      text: 'While at peace you cannot attack. Open the rival’s menu and declare war: from now on the army can advance.',
    },
  },
  'core.attack': {
    ru: {
      title: 'В наступление',
      text: 'Нажми «Наступать»: командир сам выберет направления удара и поведёт отряды на соперника. Прогноз боя виден над вражеским гексом: бей там, где он обещает победу.',
    },
    en: {
      title: 'Attack',
      text: 'Press Attack: the commander picks the strike axes and leads the units against the rival. The battle forecast is shown above the enemy hex: strike where it promises victory.',
    },
  },
  'core.conquer': {
    ru: {
      title: 'Возьми столицу',
      text: 'Продвигайся, пока не захватишь столицу соперника. Если наступление застряло у столицы, усиль армию кнопкой «+», выдели все отряды и ударь по столице вместе (ПКМ по ней), следи за снабжением.',
    },
    en: {
      title: 'Capture the capital',
      text: 'Advance until you capture the rival’s capital. If the offensive stalls at the capital, strengthen the army with +, select all units and strike the capital together (right-click it), and watch the supply.',
    },
  },
  'core.finish': {
    ru: {
      title: 'Победа!',
      text: 'Ты занял землю, построил город, склад и дорогу, собрал армию, подвёл её к фронту со снабжением и взял столицу. Это весь цикл игры. Можно вернуться в меню или остаться в матче.',
    },
    en: {
      title: 'Victory!',
      text: 'You took land, built a city, a depot and a road, raised an army, brought it to the front with supply and captured the capital. That is the whole game loop. Go back to the menu or stay in the match.',
    },
  },
};

/** Тексты шага на языке браузера; для шага без текста — пустая заготовка. */
export function stepCopy(
  chapter: ChapterId,
  step: string,
  touch: boolean,
): {
  readonly title: string;
  readonly text: string;
  readonly hint: string | null;
} {
  const both = TEXTS[`${chapter}.${step}`];
  const copy = both?.[lang] ?? both?.ru;
  if (!copy) return { title: step, text: '', hint: null };
  return { title: copy.title, text: copy.text, hint: (touch ? copy.touch : copy.mouse) ?? null };
}

/** Есть ли текст у каждого шага главы (проверяется тестом). */
export function hasCopy(chapter: ChapterId, step: string): boolean {
  return TEXTS[`${chapter}.${step}`] !== undefined;
}

/** Ключи шагов, у которых нет текста на обоих языках: пусто, если обучение переведено целиком. */
export function missingCopy(): string[] {
  return Object.entries(TEXTS)
    .filter(([, both]) => !both.ru.title || !both.ru.text || !both.en.title || !both.en.text)
    .map(([key]) => key);
}
