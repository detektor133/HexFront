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
  'core.welcome': {
    ru: {
      title: 'Учебный матч',
      text: 'Здесь никто не нападёт, пока ты сам не начнёшь войну. Шаг засчитывается, когда ты действительно сделал действие. Выйти можно в любой момент.',
    },
    en: {
      title: 'Practice match',
      text: 'Nobody attacks you until you start a war. A step counts only when you really do the action. You can leave at any time.',
    },
  },
  'core.pan': {
    ru: {
      title: 'Двигай карту',
      text: 'Смотри, что вокруг: карта больше экрана.',
      touch: 'Потяни карту одним пальцем за пустое место.',
      mouse: 'Зажми правую кнопку мыши на пустом месте и потяни.',
    },
    en: {
      title: 'Move the map',
      text: 'The map is bigger than the screen.',
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
      text: 'Задай, сколько войск послать, и нажми «Занять»: ИИ сам разошлёт отряды и захватит землю вокруг. «Состав» раскрывает, из чего собирать армию.',
    },
    en: {
      title: 'Occupy land',
      text: 'Choose how many troops to send and press Occupy: the AI spreads the units and takes the land. Composition shows what the army is made of.',
    },
  },
  'core.people': {
    ru: {
      title: 'Люди',
      text: 'Народ — основа всего. Он растёт на твоей земле, из людей набираются солдаты и появляются города. Рядом с числом — прирост в секунду.',
    },
    en: {
      title: 'People',
      text: 'People are the base of everything. They grow on your land; soldiers are recruited from them and cities are founded on them. The number beside it is growth per second.',
    },
  },
  'core.gold': {
    ru: {
      title: 'Золото',
      text: 'Золото приходит от налога и тратится на стройку и набор. Под числом — прибыль в секунду: содержание войск её уменьшает.',
    },
    en: {
      title: 'Gold',
      text: 'Gold comes from tax and is spent on building and recruiting. Below the number is income per second; army upkeep reduces it.',
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
      title: 'Город растёт из людей',
      text: 'Город можно основать на своём гексе, где достаточно людей и далеко от других городов. Люди растут сами, а налог их замедляет: подожди, пока подсвеченный гекс наполнится.',
    },
    en: {
      title: 'Cities grow from people',
      text: 'A city can be founded on your hex with enough people and far from other cities. People grow on their own and tax slows them: wait for the marked hex to fill up.',
    },
  },
  'core.city': {
    ru: {
      title: 'Основай город',
      text: 'Людей хватает. Откроется карточка гекса: нажми «основать город». Стройка идёт 30 секунд и стоит золота.',
      touch: 'Коснись подсвеченного гекса, затем значка города.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе, затем на значок города.',
    },
    en: {
      title: 'Found a city',
      text: 'There are enough people. The hex card opens: press found city. Construction takes 30 seconds and costs gold.',
      touch: 'Tap the marked hex, then the city icon.',
      mouse: 'Left-click the marked hex, then the city icon.',
    },
  },
  'core.hammer': {
    ru: {
      title: 'Молоточек: строительство',
      text: 'Всё, что строится на карте, — через молоточек справа внизу: он включает режим строительства и подсвечивает гексы, где можно строить прямо сейчас.',
      touch: 'Коснись молоточка.',
      mouse: 'Нажми на молоточек.',
    },
    en: {
      title: 'Hammer: building',
      text: 'Everything built on the map goes through the hammer at the bottom right: it turns on build mode and highlights hexes where you can build right now.',
      touch: 'Tap the hammer.',
      mouse: 'Click the hammer.',
    },
  },
  'core.improveTool': {
    ru: {
      title: 'Что строить',
      text: 'В ряду над молоточком — город, склад, укрепление и благоустройство. Выбери благоустройство: оно дёшево и поднимает предел людей на гексе. В панели видно цену и твоё золото.',
    },
    en: {
      title: 'What to build',
      text: 'The row above the hammer has city, depot, fort and improvement. Pick improvement: it is cheap and raises a hex population limit. The bar shows the price and your gold.',
    },
  },
  'core.improve': {
    ru: {
      title: 'Построй',
      text: 'Нажми на подсвеченный гекс: золото спишется сразу, стройка пойдёт, режим останется включённым. Если гекс бледнее — золота мало, клик объяснит. Выйти из режима — Esc, правая кнопка или молоточек.',
      touch: 'Коснись подсвеченного гекса.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'Build',
      text: 'Press a highlighted hex: gold is spent at once, construction starts and the mode stays on. A paler hex means gold is short and the click explains. Leave the mode with Esc, right click or the hammer.',
      touch: 'Tap a highlighted hex.',
      mouse: 'Left-click a highlighted hex.',
    },
  },
  'core.war': {
    ru: {
      title: 'Объяви войну',
      text: 'Пока вы в мире, наступать нельзя. Нажми значок мечей в меню соперника: война объявлена, и появится кнопка «Наступать». Из войны выход один — мир.',
      touch: 'Коснись значка мечей в меню.',
      mouse: 'Нажми на значок мечей в меню.',
    },
    en: {
      title: 'Declare war',
      text: 'You cannot attack while at peace. Press the swords icon in the rival menu: war is declared and the Attack button appears. The only way out of war is peace.',
      touch: 'Tap the swords icon in the menu.',
      mouse: 'Click the swords icon in the menu.',
    },
  },
  'core.enemy': {
    ru: {
      title: 'Соперник',
      text: 'На другом конце карты чужая страна. Нажми на неё без выбранных отрядов: откроется меню с дипломатией и приказами.',
      touch: 'Коснись подсвеченного гекса.',
      mouse: 'Нажми левую кнопку мыши на подсвеченном гексе.',
    },
    en: {
      title: 'The rival',
      text: 'A foreign country lies across the map. Press it with no units selected: a menu with diplomacy and orders opens.',
      touch: 'Tap the marked hex.',
      mouse: 'Left-click the marked hex.',
    },
  },
  'core.attack': {
    ru: {
      title: 'Наступление',
      text: 'Война объявлена. Нажми «Наступать»: ИИ сам выберет, где бить, построит линии и поведёт армию. «Держать» вместо этого просто прикроет границу.',
    },
    en: {
      title: 'Offensive',
      text: 'War is declared. Press Attack: the AI picks where to strike, draws the lines and leads the army. Hold just covers the border instead.',
    },
  },
  'core.finish': {
    ru: {
      title: 'Основы пройдены',
      text: 'Дальше — сама игра: расширяйся, расти города, держи снабжение. Главы про снабжение, армии и строительство — в меню «Обучение».',
    },
    en: {
      title: 'Basics done',
      text: 'Now the game itself: expand, grow cities, keep supply. Chapters on supply, armies and building are in the Tutorial menu.',
    },
  },
  'supply.intro': {
    ru: {
      title: 'Снабжение',
      text: 'Армия ест. Чем дальше от склада и города, тем хуже снабжение, и отряды теряют организацию. Общий показатель — в шапке.',
    },
    en: {
      title: 'Supply',
      text: 'Armies eat. The farther from a depot or city, the worse the supply and the more organisation units lose. The overall figure is in the top bar.',
    },
  },
  'supply.mode': {
    ru: {
      title: 'Карта снабжения',
      text: 'Включи режим карты снабжения: зелёное — снабжено, красное — нет.',
      touch: 'Коснись значка карты снабжения справа внизу.',
      mouse: 'Нажми на значок карты снабжения справа внизу.',
    },
    en: {
      title: 'Supply map',
      text: 'Switch to the supply map: green is supplied, red is not.',
      touch: 'Tap the supply map icon at the bottom right.',
      mouse: 'Click the supply map icon at the bottom right.',
    },
  },
  'supply.hammer': {
    ru: {
      title: 'Строительство',
      text: 'Молоточек включает режим строительства: подсвечены гексы, где можно строить прямо сейчас.',
    },
    en: {
      title: 'Building',
      text: 'The hammer turns on build mode: hexes where you can build right now are highlighted.',
    },
  },
  'supply.depotTool': {
    ru: { title: 'Склад', text: 'Выбери склад в ряду построек: он кормит армию рядом.' },
    en: { title: 'Depot', text: 'Pick the depot in the row: it feeds the army nearby.' },
  },
  'supply.depot': {
    ru: {
      title: 'Поставь склад',
      text: 'Нажми на подсвеченный гекс. В панели видно цену и золото; если золота мало, гекс бледнее и кнопка скажет почему.',
    },
    en: {
      title: 'Place a depot',
      text: 'Press a highlighted hex. The bar shows the price and your gold; if gold is short the hex is paler and the click tells you why.',
    },
  },
  'supply.finish': {
    ru: {
      title: 'Готово',
      text: 'Склады улучшаются до пятого уровня и расширяют снабжение. Держи их у фронта.',
    },
    en: {
      title: 'Done',
      text: 'Depots upgrade to level five and widen supply. Keep them near the front.',
    },
  },
  'armies.cards': {
    ru: {
      title: 'Армии',
      text: 'Отряды сведены в армии. На карточке: имя, организация, снабжение, число солдат и лимит. Значок показывает приказ: щит, мечи или флаг.',
    },
    en: {
      title: 'Armies',
      text: 'Units are grouped into armies. The card shows name, organisation, supply, soldier count and the limit. The icon shows the order: shield, swords or flag.',
    },
  },
  'armies.pick': {
    ru: {
      title: 'Выбери армию',
      text: 'Выбери карточку: над ней появятся приказы.',
      touch: 'Коснись карточки армии.',
      mouse: 'Нажми левую кнопку мыши на карточке армии.',
    },
    en: {
      title: 'Pick an army',
      text: 'Pick a card: orders appear above it.',
      touch: 'Tap the army card.',
      mouse: 'Left-click the army card.',
    },
  },
  'armies.limit': {
    ru: {
      title: 'Лимит армии',
      text: 'Число с «∞» — лимит армии. Задай его ползунком: ИИ будет добирать армию до лимита из резерва и закупкой, «Состав» меняет типы войск.',
    },
    en: {
      title: 'Army limit',
      text: 'The number with ∞ is the army limit. Set it with the slider: the AI tops the army up from the reserve and by recruiting; Composition changes unit types.',
    },
  },
  'armies.split': {
    ru: {
      title: 'Раздели армию',
      text: 'Нажми на значок деления: армия разойдётся на две примерно равные части.',
    },
    en: {
      title: 'Split the army',
      text: 'Press the split icon: the army divides into two roughly equal halves.',
    },
  },
  'armies.finish': {
    ru: {
      title: 'Готово',
      text: 'Армия остаётся со своими отрядами и лимитом, пока ты сам её не расформируешь.',
    },
    en: { title: 'Done', text: 'An army keeps its units and limit until you disband it yourself.' },
  },
  'building.hammer': {
    ru: { title: 'Строительство', text: 'Включи молоточек: откроется ряд построек.' },
    en: { title: 'Building', text: 'Turn on the hammer: a row of buildings opens.' },
  },
  'building.fortTool': {
    ru: {
      title: 'Укрепление',
      text: 'Укрепление усиливает оборону гекса у границы; его можно улучшить до укрепрайона.',
    },
    en: {
      title: 'Fortification',
      text: 'A fort strengthens a border hex; it upgrades to a fortified region.',
    },
  },
  'building.fort': {
    ru: {
      title: 'Поставь укрепление',
      text: 'Нажми на подсвеченный гекс. Золото спишется сразу, стройка пойдёт.',
    },
    en: {
      title: 'Place a fort',
      text: 'Press a highlighted hex. Gold is spent at once and construction starts.',
    },
  },
  'building.improveTool': {
    ru: { title: 'Благоустройство', text: 'Благоустройство увеличивает население гекса.' },
    en: { title: 'Improvement', text: 'An improvement raises a hex population limit.' },
  },
  'building.improve': {
    ru: {
      title: 'Улучши гекс',
      text: 'Нажми на подсвеченный гекс: рядом с гексом появится знак стройки.',
    },
    en: {
      title: 'Improve a hex',
      text: 'Press a highlighted hex: a construction mark appears there.',
    },
  },
  'building.list': {
    ru: {
      title: 'Список построек',
      text: 'Здесь все города, склады, укрепления и стройки: оттуда улучшают и находят их на карте.',
    },
    en: {
      title: 'Buildings list',
      text: 'All cities, depots, forts and constructions: upgrade them and find them on the map from here.',
    },
  },
  'building.finish': {
    ru: {
      title: 'Готово',
      text: 'Улучшения идут по уровням: город, склад и укрепление растут за золото и время.',
    },
    en: {
      title: 'Done',
      text: 'Upgrades go by level: cities, depots and forts grow for gold and time.',
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
