import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Command, MapStatic, PlayerView } from '@hexfront/sim';
import { FP, loadMap } from '@hexfront/sim';

import { NOTHING_PICKED } from '../src/dev/sandbox-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { readLocalMatchSetup } from '../src/local/match-setup.ts';
import { begin, next, settle } from '../src/tutorial/engine.ts';
import { tutorialUrl } from '../src/tutorial/links.ts';
import {
  ARMY_GOAL,
  CHAPTERS,
  START_GOLD,
  STEPS,
  cityProgress,
  citySite,
  enemyBorderHex,
  enemyCapital,
  frontSupplied,
  frontUnits,
  neutralNear,
  soldiersOwn,
  unitHex,
  type TutorialCtx,
} from '../src/tutorial/script.ts';
import { hasCopy, missingCopy } from '../src/tutorial/texts.ts';

const tiny: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tiny);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const MAP: MapStatic = loaded.map;

function start() {
  const e = createLocalEngine(tiny, 42, 2, [], false, '', true, true);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const gold = e.state.players[0];
  if (gold) gold.gold = (START_GOLD * FP) as typeof gold.gold;
  let last: PlayerView | null = null;
  const tick = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      const m = e.tick();
      if (m.t === 'view') last = m.view;
    }
  };
  tick(1);
  return {
    engine: e,
    view: () => {
      if (!last) throw new Error('нет снимка');
      return last;
    },
    tick,
    queue: (c: Command) => e.queue(c),
  };
}

const ctxOf = (view: PlayerView, extra: Partial<TutorialCtx> = {}): TutorialCtx => ({
  view,
  map: MAP,
  picked: NOTHING_PICKED,
  menuOther: null,
  army: null,
  build: null,
  mapMode: 'normal',
  buildingsOpen: false,
  pans: 0,
  zooms: 0,
  ...extra,
});

describe('обучение: сценарий', () => {
  it('обучение одно, у каждого шага есть текст на обоих языках', () => {
    expect(CHAPTERS).toEqual(['core']);
    expect(missingCopy()).toEqual([]);
    for (const step of STEPS.core) expect(hasCopy('core', step.id), step.id).toBe(true);
  });

  it('обучение проводит по всему циклу: земля, город, склад, дорога, армия, фронт, война', () => {
    const ids = STEPS.core.map((x) => x.id);
    const order = [
      'occupy',
      'city',
      'depot',
      'road',
      'armyPlus',
      'recruit',
      'hold',
      'front',
      'supplyFront',
      'war',
      'attack',
      'conquer',
      'finish',
    ];
    const at = order.map((id) => ids.indexOf(id));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('обучение не начинается с описания: первый шаг — действие, объяснение стоит до «Понятно»', () => {
    const s = start();
    const ctx = ctxOf(s.view());
    expect(STEPS.core[0]?.manual).not.toBe(true);
    const first = settle('core', begin('core', ctx), ctx);
    expect(first.index).toBe(0);
    expect(settle('core', first, ctxOf(s.view(), { pans: 1 })).index).toBeGreaterThan(0);
    const economy = STEPS.core.findIndex((x) => x.id === 'economy');
    const at = { index: economy, base: 0 };
    expect(settle('core', at, ctx).index).toBe(economy);
    expect(next('core', at, ctx).index).toBe(economy + 1);
  });

  it('после приказа выбор снимается отдельным шагом, и только потом нажатие по ничьей земле открывает меню', () => {
    const ids = STEPS.core.map((x) => x.id);
    expect(ids.indexOf('deselect')).toBe(ids.indexOf('move') + 1);
    expect(ids.indexOf('menu')).toBe(ids.indexOf('deselect') + 1);
    const s = start();
    const view = s.view();
    const selected = { hex: null, units: [view.units[0]?.id ?? -1], target: null };
    const deselect = STEPS.core.find((x) => x.id === 'deselect');
    expect(deselect?.done?.(ctxOf(view, { picked: selected }), 0)).toBe(false);
    expect(deselect?.done?.(ctxOf(view, { picked: selected, army: 1 }), 0)).toBe(false);
    expect(deselect?.done?.(ctxOf(view), 0)).toBe(true);
    const target = deselect?.target;
    expect(target && 'hex' in target ? target.hex(ctxOf(view)) : null).not.toBeNull();
  });

  it('выбор отряда засчитывает шаг «выбери», а подсказка смотрит на гекс отряда', () => {
    const s = start();
    const view = s.view();
    expect(unitHex(ctxOf(view))).not.toBeNull();
    const selectIndex = STEPS.core.findIndex((x) => x.id === 'select');
    const here = { index: selectIndex, base: 0 };
    expect(settle('core', here, ctxOf(view)).index).toBe(selectIndex);
    const picked = { hex: null, units: [view.units[0]?.id ?? -1], target: null };
    expect(settle('core', here, ctxOf(view, { picked })).index).toBeGreaterThan(selectIndex);
    expect(neutralNear(ctxOf(view))).not.toBeNull();
  });

  it('город: пока людей мало — ждём с полосой; потом шаг ожидания засчитан', () => {
    const s = start();
    s.queue({ t: 'launchOffensive', target: -1, soldiers: 200 });
    s.tick(100);
    expect(cityProgress(ctxOf(s.view()))).toBeLessThan(1);
    s.tick(1500);
    const late = ctxOf(s.view());
    expect(citySite(late)).not.toBeNull();
    expect(cityProgress(late)).toBe(1);
    const wait = STEPS.core.findIndex((x) => x.id === 'wait');
    expect(settle('core', { index: wait, base: 0 }, late).index).toBeGreaterThan(wait);
  });

  it('цели шагов найдутся: граница и столица соперника есть на карте урока', () => {
    const s = start();
    const ctx = ctxOf(s.view());
    expect(enemyCapital(ctx)).not.toBeNull();
    expect(enemyBorderHex(ctx)).not.toBeNull();
  });
});

describe('матч-урок', () => {
  it('ссылка открывает урок: два игрока, соперник без бота, золота хватает на всё', () => {
    const url = new URL(tutorialUrl('Аня', 'teal'), 'http://x');
    const setup = readLocalMatchSetup(url.search);
    expect(setup.tutorial).toBe('core');
    expect(setup.bots).toEqual([]);
    expect(setup.count).toBe(2);
    expect(setup.initialGold).toBe(START_GOLD * 1000);
  });

  it('в уроке мир: «Наступать» недоступно, пока игрок сам не объявит войну', () => {
    const s = start();
    const war = STEPS.core.find((x) => x.id === 'war');
    expect(war?.done?.(ctxOf(s.view()), 0)).toBe(false);
    s.queue({ t: 'declareWar', target: 1 });
    s.tick(3);
    expect(war?.done?.(ctxOf(s.view()), 0)).toBe(true);
  });

  it('соперник стоит и ничего не делает, пока урок не дошёл до шага «держи границу»', () => {
    const s = start();
    const foeHexes = (): number => s.view().hexes.owner.filter((o) => o === 1).length;
    const foeUnits = (): number => s.view().units.filter((u) => u.owner === 1).length;
    const hexes = foeHexes();
    const units = foeUnits();
    s.engine.setTutorialStage('city');
    s.tick(1200);
    expect(foeHexes()).toBe(hexes);
    expect(foeUnits()).toBe(units);
  });
});

describe('урок проходим от начала до победы', () => {
  it('игрок, делающий то, о чём просит урок, берёт столицу соперника', () => {
    const s = start();
    const me = (): TutorialCtx => ctxOf(s.view());
    const done = (id: string, base = 0): boolean =>
      STEPS.core.find((x) => x.id === id)?.done?.(me(), base) ?? false;

    // Занять землю.
    s.queue({ t: 'launchOffensive', target: -1, soldiers: 200 });
    s.tick(1700);
    expect(done('wait')).toBe(true);

    // Город.
    const site = citySite(me());
    expect(site).not.toBeNull();
    s.queue({ t: 'foundCity', hex: site ?? 0 });
    s.tick(900);
    expect(s.view().cities.filter((c) => c.owner === 0).length).toBeGreaterThan(1);

    // Склад как можно ближе к границе с соперником и дорога вручную к нему от столицы.
    const border = enemyBorderHex(me()) ?? 0;
    const owner = s.view().hexes.owner;
    const w = MAP.width;
    const at = (h: number) => ({ q: h % w, r: Math.floor(h / w) });
    const gap = (a: number, b: number): number =>
      Math.abs(at(a).q - at(b).q) + Math.abs(at(a).r - at(b).r);
    const own = [...owner.keys()].filter(
      (h) =>
        owner[h] === 0 &&
        MAP.terrain[h] !== 0 &&
        !s.view().cities.some((c) => c.hex === h) &&
        !s.view().units.some((u) => u.hex === h && u.owner !== 0),
    );
    own.sort((a, b) => gap(a, border) - gap(b, border) || a - b);
    const capital = s.view().cities.find((c) => c.owner === 0 && c.isCapital)?.hex ?? 0;
    let depotHex = -1;
    for (const h of own.slice(0, 12)) {
      s.queue({ t: 'build', hex: h, kind: 'depot' });
      s.tick(2);
      if (s.view().constructions.some((c) => c.kind === 'depot' && c.hex === h)) {
        depotHex = h;
        break;
      }
    }
    expect(depotHex).toBeGreaterThanOrEqual(0);
    s.tick(1500);
    s.queue({ t: 'buildRoad', points: [capital, depotHex] });
    s.tick(5);

    // Армия до нужного размера.
    const army = s.view().armies[0];
    expect(army).toBeDefined();
    s.queue({ t: 'setArmyLimit', armyId: army?.id ?? 0, soldiers: ARMY_GOAL });
    s.tick(2500);
    expect(soldiersOwn(me())).toBeGreaterThanOrEqual(ARMY_GOAL * 0.9);

    // Держать границу: соперник набирает оборону, армия встаёт у границы со снабжением.
    s.engine.setTutorialStage('hold');
    s.queue({ t: 'holdBorder', target: 1, soldiers: ARMY_GOAL, armyId: army?.id ?? 0 });
    s.tick(2500);
    expect(frontUnits(me()).length).toBeGreaterThan(0);
    expect(frontSupplied(me())).toBe(true);
    const foes = s.view().units.filter((u) => u.owner === 1);
    expect(foes.length).toBeGreaterThan(0);

    // Война и наступление до победы.
    s.queue({ t: 'declareWar', target: 1 });
    s.tick(3);
    s.queue({ t: 'launchOffensive', target: 1, soldiers: ARMY_GOAL, armyId: army?.id ?? 0 });
    const capitalHex = enemyCapital(me())?.hex ?? -1;
    let won = false;
    for (let i = 0; i < 12000 && !won; i += 100) {
      s.tick(100);
      won =
        s.view().winner >= 0 || s.view().cities.some((c) => c.hex === capitalHex && c.owner === 0);
    }
    expect(won).toBe(true);
  }, 300_000);
});
