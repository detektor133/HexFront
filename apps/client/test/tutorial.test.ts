import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { MapStatic, PlayerView } from '@hexfront/sim';
import { loadMap } from '@hexfront/sim';

import { NOTHING_PICKED } from '../src/dev/sandbox-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { begin, next, settle } from '../src/tutorial/engine.ts';
import {
  CHAPTERS,
  STEPS,
  cityProgress,
  citySite,
  neutralNear,
  unitHex,
  type ChapterId,
  type TutorialCtx,
} from '../src/tutorial/script.ts';
import { hasCopy, missingCopy } from '../src/tutorial/texts.ts';

const tiny: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tiny);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const MAP: MapStatic = loaded.map;

function start(): { view: () => PlayerView; tick: (n: number) => void; queue: (c: never) => void } {
  const e = createLocalEngine(tiny, 42, 2, [], false, '', true, true);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  let last: PlayerView | null = null;
  const tick = (n: number): void => {
    for (let i = 0; i < n; i += 1) {
      const m = e.tick();
      if (m.t === 'view') last = m.view;
    }
  };
  tick(1);
  return {
    view: () => {
      if (!last) throw new Error('нет снимка');
      return last;
    },
    tick,
    queue: (c) => e.queue(c),
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

describe('обучение', () => {
  it('у каждого шага каждой главы есть текст на обоих языках', () => {
    expect(missingCopy()).toEqual([]);
    for (const chapter of CHAPTERS) {
      for (const step of STEPS[chapter]) {
        expect(hasCopy(chapter, step.id), `${chapter}.${step.id}`).toBe(true);
      }
    }
  });

  it('шаг-объяснение стоит, пока не нажали «Понятно»; шаги с действием идут по действию', () => {
    const s = start();
    const ctx = ctxOf(s.view());
    const first = settle('core', begin('core', ctx), ctx);
    expect(first.index).toBe(0);
    const pan = next('core', first, ctx);
    expect(settle('core', pan, ctx).index).toBe(1);
    expect(settle('core', pan, ctxOf(s.view(), { pans: 1 })).index).toBeGreaterThan(1);
  });

  it('выбор отряда засчитывает шаг «выбери», а подсказка смотрит на гекс отряда', () => {
    const s = start();
    const view = s.view();
    const at = unitHex(ctxOf(view));
    expect(at).not.toBeNull();
    const selectIndex = STEPS.core.findIndex((x) => x.id === 'select');
    const here = { index: selectIndex, base: 0 };
    expect(settle('core', here, ctxOf(view)).index).toBe(selectIndex);
    const picked = { hex: null, units: [view.units[0]?.id ?? -1], target: null };
    expect(settle('core', here, ctxOf(view, { picked })).index).toBeGreaterThan(selectIndex);
    expect(neutralNear(ctxOf(view))).not.toBeNull();
  });

  it('город: пока людей мало — ждём, подсказка показывает прогресс; потом шаг ожидания засчитан', () => {
    const s = start();
    s.queue({ t: 'launchOffensive', target: -1, soldiers: 200 } as never);
    s.tick(100);
    const early = ctxOf(s.view());
    expect(cityProgress(early)).toBeLessThan(1);
    s.tick(1500);
    const late = ctxOf(s.view());
    expect(citySite(late)).not.toBeNull();
    expect(cityProgress(late)).toBe(1);
    const wait = STEPS.core.findIndex((x) => x.id === 'wait');
    expect(settle('core', { index: wait, base: 0 }, late).index).toBeGreaterThan(wait);
  });

  it('цели шагов найдутся: соперник и свободная земля есть на карте урока', () => {
    const s = start();
    const ctx = ctxOf(s.view());
    const enemy = STEPS.core.find((x) => x.id === 'enemy');
    const target = enemy?.target;
    expect(target && 'hex' in target ? target.hex(ctx) : null).not.toBeNull();
    const chapters: readonly ChapterId[] = CHAPTERS;
    expect(chapters).toContain('core');
  });
});

describe('матч-урок', () => {
  it('ссылка главы открывает урок: два игрока, соперник без бота, золото главы', async () => {
    const { tutorialUrl } = await import('../src/tutorial/links.ts');
    const { readLocalMatchSetup } = await import('../src/local/match-setup.ts');
    const url = new URL(tutorialUrl('supply', 'Аня', 'teal'), 'http://x');
    const setup = readLocalMatchSetup(url.search);
    expect(setup.tutorial).toBe('supply');
    expect(setup.bots).toEqual([]);
    expect(setup.count).toBe(2);
    expect(setup.initialGold).toBe(600_000);
  });
});

describe('война и строительство в обучении', () => {
  it('в уроке мир: «Наступать» недоступно, пока игрок сам не объявит войну', () => {
    const s = start();
    const war = STEPS.core.find((x) => x.id === 'war');
    expect(war?.done?.(ctxOf(s.view()), 0)).toBe(false);
    s.queue({ t: 'declareWar', target: 1 } as never);
    s.tick(3);
    expect(war?.done?.(ctxOf(s.view()), 0)).toBe(true);
  });

  it('молоточек учит строить: шаги идут по режиму строительства и самой стройке', () => {
    const ids = STEPS.core.map((x) => x.id);
    expect(ids.indexOf('hammer')).toBeGreaterThan(ids.indexOf('recruit'));
    expect(ids.indexOf('improve')).toBeLessThan(ids.indexOf('enemy'));
    expect(ids.indexOf('war')).toBeLessThan(ids.indexOf('attack'));
    const s = start();
    const hammer = STEPS.core.find((x) => x.id === 'hammer');
    expect(hammer?.done?.(ctxOf(s.view()), 0)).toBe(false);
    expect(hammer?.done?.(ctxOf(s.view(), { build: 'improve' }), 0)).toBe(true);
  });
});
