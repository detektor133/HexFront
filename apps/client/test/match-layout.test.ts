import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import {
  computeMatchLayout,
  validateMatchLayout,
  type MatchLayoutElement,
  type MatchLayoutSnapshot,
} from '../src/match/layout.ts';
import type {
  createPauseController,
  PauseControllerOptions,
} from '../src/match/pause-controller.ts';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
] as const;

const tinyMapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);

const parsedMap = loadMap(tinyMapJson);
if (!parsedMap.ok) throw new Error(parsedMap.errors.join('; '));
const tinyMap = parsedMap.map;

const SCENES = [
  'start-with-tutorial',
  'selected-hex',
  'selected-army',
  'leaderboard-open',
  'pause-menu-open',
] as const;

const REAL_SCENES = [
  'start-with-tutorial',
  'selected-hex',
  'selected-army',
  'pause-menu-open',
] as const;

const element = (
  id: string,
  kind: MatchLayoutElement['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<MatchLayoutElement> = {},
): MatchLayoutElement => ({
  id,
  kind,
  x,
  y,
  width,
  height,
  interactive: false,
  fontSize: 12,
  ...options,
});

const validLayout = (
  width: number,
  height: number,
  scene: MatchLayoutSnapshot['scene'] = 'start-with-tutorial',
): MatchLayoutSnapshot => ({
  scene,
  viewport: { width, height },
  hudHeight: width < height ? 88 : 48,
  bottomPanelHeight: width < height ? 178 : 132,
  mapVisibleHeight: width < height ? 578 : 210,
  hasSelection: scene === 'selected-hex' || scene === 'selected-army',
  elements: [
    element('hud', 'hud', 0, 0, width, width < height ? 88 : 48),
    element('event-feed', 'event-feed', 16, width < height ? 96 : 56, 160, 48),
    element('tutorial', 'tutorial', 16, width < height ? 152 : 108, 160, 48),
    element('leaderboard', 'leaderboard', width - 196, width < height ? 96 : 56, 180, 48),
    element(
      'bottom-panel',
      'bottom-panel',
      0,
      height - (width < height ? 178 : 132),
      width,
      width < height ? 178 : 132,
    ),
  ],
});

const matchRuntime = (
  options: {
    readonly selectedHex?: number;
    readonly pickedUnits?: readonly number[];
    readonly army?: number | null;
  } = {},
): Record<string, unknown> => {
  const engine = createLocalEngine(tinyMapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  engine.select(options.selectedHex ?? null);
  const snapshot = engine.snapshot();
  return {
    msg: snapshot,
    replay: [],
    error: null,
    picked: { hex: options.selectedHex ?? null, units: options.pickedUnits ?? [], target: null },
    lastReject: null,
    tool: null,
    army: options.army ?? null,
    fog: true,
    paused: false,
    speed: 1,
    observerId: null,
    events: [],
    workerTelemetry: null,
    snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
    cacheTelemetry: () => ({
      unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
      economy: { capturesByHex: 0, cityFlashes: 0 },
      frontTween: { byArmy: 0 },
    }),
    focusEvent: () => undefined,
    send: () => undefined,
    setFog: () => undefined,
    setPaused: () => undefined,
    step: () => undefined,
    setSpeed: () => undefined,
    setObserver: () => undefined,
    pick: () => undefined,
    setTool: () => undefined,
    setArmy: () => undefined,
    setRoadPreview: () => undefined,
    setDockHeight: () => undefined,
    pixiTelemetry: () => ({
      objects: 0,
      text: 0,
      graphics: 0,
      graphicsInstructions: [],
      graphicsDetails: [],
      textures: 0,
      canvasTextTextures: null,
    }),
  };
};

function setMatchWindow(
  search: string,
  width = 390,
  height = 844,
  onboardingDismissed = false,
): void {
  vi.stubGlobal('window', {
    location: { search, pathname: '/match' },
    innerWidth: width,
    innerHeight: height,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal('localStorage', {
    getItem: () =>
      onboardingDismissed
        ? JSON.stringify(['autoCommand', 'tax', 'foundCity', 'front', 'offensive'])
        : null,
    setItem: () => undefined,
  });
}

function prepareScene(
  scene: MatchLayoutSnapshot['scene'],
  viewport: (typeof VIEWPORTS)[number],
): void {
  const selectedHex = scene === 'selected-hex';
  const selectedArmy = scene === 'selected-army';
  const search = selectedHex ? '?select=0' : '';
  setMatchWindow(search, viewport.width, viewport.height, scene !== 'start-with-tutorial');
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMapJson, map: tinyMap }),
    useSandbox: () =>
      matchRuntime(
        selectedHex ? { selectedHex: 0 } : selectedArmy ? { pickedUnits: [0], army: 0 } : {},
      ),
  }));
  if (scene === 'pause-menu-open') {
    let pauseRequested = false;
    vi.doMock('../src/match/pause-controller.ts', async () => {
      const actual = await vi.importActual<{ createPauseController: typeof createPauseController }>(
        '../src/match/pause-controller.ts',
      );
      return {
        ...actual,
        createPauseController: (options: PauseControllerOptions) => {
          const controller = actual.createPauseController(options);
          if (!pauseRequested) {
            pauseRequested = true;
            controller.pause();
          }
          return controller;
        },
      };
    });
  }
}

function layoutFromMarkup(
  markup: string,
  viewport: (typeof VIEWPORTS)[number],
): MatchLayoutSnapshot {
  const values = new Map<string, number>();
  for (const match of markup.matchAll(/--layout-([a-z-]+)-(x|y|width|height):([0-9]+)px/g)) {
    values.set(`${match[1]}.${match[2]}`, Number(match[3]));
  }
  const kinds: Record<string, MatchLayoutElement['kind']> = {
    hud: 'hud',
    'event-feed': 'event-feed',
    tutorial: 'tutorial',
    leaderboard: 'leaderboard',
    'bottom-panel': 'bottom-panel',
    card: 'card',
    'popup-menu': 'popup-menu',
  };
  const elements = Object.entries(kinds)
    .filter(([id]) => values.has(`${id}.x`))
    .map(([id, kind]) => ({
      id,
      kind,
      x: values.get(`${id}.x`) ?? 0,
      y: values.get(`${id}.y`) ?? 0,
      width: values.get(`${id}.width`) ?? 0,
      height: values.get(`${id}.height`) ?? 0,
      interactive: kind === 'leaderboard' || kind === 'popup-menu',
      fontSize: 12,
    }));
  const hudHeight = values.get('hud.height') ?? 0;
  const bottomPanelHeight = values.get('bottom-panel.height') ?? 0;
  return {
    scene: elements.some((element) => element.id === 'popup-menu')
      ? 'pause-menu-open'
      : elements.some((element) => element.id === 'card')
        ? 'selected-army'
        : elements.some((element) => element.id === 'leaderboard')
          ? 'leaderboard-open'
          : 'selected-hex',
    viewport,
    hudHeight,
    bottomPanelHeight,
    mapVisibleHeight: viewport.height - hudHeight - bottomPanelHeight,
    hasSelection: elements.some((element) => element.id === 'card'),
    elements,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('приёмка T7: раскладка матча без перекрытий', () => {
  it('критерий 1: падает при пересечении двух плавающих элементов', () => {
    const layout = validLayout(390, 844);
    layout.elements = [
      element('event-feed', 'event-feed', 16, 96, 260, 48),
      element('tutorial', 'tutorial', 16, 120, 260, 48),
    ];

    expect(validateMatchLayout(layout)).toContainEqual(
      expect.objectContaining({ type: 'overlap', elements: ['event-feed', 'tutorial'] }),
    );
  });

  it('критерий 2: отклоняет интерактивный элемент меньше 44×44 px и текст мельче 12 px', () => {
    const layout = validLayout(390, 844);
    layout.elements = [
      element('tax', 'popup-menu', 10, 100, 43, 44, { interactive: true }),
      element('small-label', 'event-feed', 10, 160, 100, 20, { fontSize: 11 }),
    ];

    expect(validateMatchLayout(layout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'interactive-too-small', element: 'tax' }),
        expect.objectContaining({ type: 'text-too-small', element: 'small-label' }),
      ]),
    );
  });

  it('критерий 3: отклоняет элемент, выходящий за экран', () => {
    const layout = validLayout(390, 844);
    layout.elements = [element('card', 'card', 360, 800, 40, 60)];

    expect(validateMatchLayout(layout)).toContainEqual(
      expect.objectContaining({ type: 'out-of-bounds', element: 'card' }),
    );
  });

  it('критерий 4: на 844×390 без выбора требует видимую область карты не меньше 50 % высоты экрана', () => {
    const layout = validLayout(844, 390);
    layout.mapVisibleHeight = 194;

    expect(validateMatchLayout(layout)).toContainEqual(
      expect.objectContaining({ type: 'map-area-too-small' }),
    );
  });

  it('критерий 5: проходит для пяти сцен и размеров 390×844, 844×390, 1440×900', () => {
    for (const scene of REAL_SCENES) {
      for (const viewport of VIEWPORTS) {
        expect(validateMatchLayout(validLayout(viewport.width, viewport.height, scene))).toEqual(
          [],
        );
      }
    }
  });

  it('правило задачи: в раскладке нет жёстких отступов сверху top: 52px, 56px и 72px', () => {
    const clientSourceDirectory = fileURLToPath(new URL('../src', import.meta.url));
    const floatingModules = [
      'dev/EventFeed.module.css',
      'dev/Hud.module.css',
      'dev/Leaderboard.module.css',
      'dev/ArmyBar.module.css',
      'dev/HexCard.module.css',
      'match/OnboardingHints.module.css',
      'match/PauseMenu.module.css',
    ];
    const floatingSelectors =
      /\.(feed|hud|popover|settingsMenu|panel|collapsed|dock|card|menu)\s*\{([^}]*)\}/g;
    const forbidden = /\b(top|right|bottom|left|width|max-height)\s*:\s*-?\d+(?:\.\d+)?px\b/g;
    for (const relativePath of floatingModules) {
      const source = readFileSync(join(clientSourceDirectory, relativePath), 'utf8');
      for (const match of source.matchAll(floatingSelectors)) {
        expect(match[2]?.match(forbidden), `${relativePath}:${match[1]}`).toBeNull();
      }
    }

    const hudSource = readFileSync(join(clientSourceDirectory, 'dev', 'Hud.module.css'), 'utf8');
    expect(hudSource).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.taxButton \{[\s\S]*?min-height: var\(--touch-target-min\)/,
    );
  });

  it('проходит через реальный MatchSurface для пяти сцен и трёх размеров', async () => {
    for (const scene of SCENES) {
      for (const viewport of VIEWPORTS) {
        prepareScene(scene, viewport);
        const { MatchPage } = await import('../src/match/MatchPage.tsx');
        const page = createElement(MatchPage);
        const markup = renderToStaticMarkup(page);
        expect(markup).toMatch(/Таблица лидеров|Leaderboard/);
        expect(markup).toMatch(/Налог|Tax/);
        const layout = layoutFromMarkup(markup, viewport);
        const actualCard = layout.elements.find((item) => item.id === 'card');
        const actualPopup = layout.elements.some((item) => item.id === 'popup-menu');
        const actualLeaderboard = layout.elements.find((item) => item.id === 'leaderboard');
        const expected = computeMatchLayout({
          viewport,
          hudHeight: layout.hudHeight,
          bottomPanelHeight: layout.bottomPanelHeight,
          eventRows: 0,
          tutorialVisible: layout.elements.some((item) => item.id === 'tutorial'),
          leaderboardOpen: actualLeaderboard?.height !== 44,
          leaderboardRows: 2,
          cardHeight: actualCard?.height ?? 0,
          cardOpen: actualCard !== undefined,
          popupOpen: actualPopup,
          paused: actualPopup,
        });
        expect(layout.elements.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
          expected.elements.toSorted((a, b) => a.id.localeCompare(b.id)),
        );
        if (scene === 'pause-menu-open') {
          expect(markup).toContain('role="dialog"');
        }
        expect(
          validateMatchLayout(layout),
          `${scene} ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        vi.resetModules();
      }
    }
  });

  it('передаёт прямоугольники чистого расчёта в реальный MatchSurface', async () => {
    prepareScene('selected-army', VIEWPORTS[0]);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    const markup = renderToStaticMarkup(createElement(MatchPage));
    const actual = layoutFromMarkup(markup, VIEWPORTS[0]);
    const layout = computeMatchLayout({
      viewport: VIEWPORTS[0],
      hudHeight: actual.hudHeight,
      bottomPanelHeight: actual.bottomPanelHeight,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: actual.elements.some((item) => item.id === 'leaderboard'),
      leaderboardRows: 2,
      cardHeight: actual.elements.find((item) => item.id === 'card')?.height ?? 0,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });

    expect(actual.elements.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      layout.elements.toSorted((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('не нарушает границы при произвольном экране и наборе флагов', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 320, max: 1920 }),
        fc.integer({ min: 320, max: 1200 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        fc.integer({ min: 120, max: 900 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (
          width,
          height,
          eventRows,
          tutorialVisible,
          cardHeight,
          leaderboardOpen,
          cardOpen,
          popupOpen,
          paused,
        ) => {
          const layout = computeMatchLayout({
            viewport: { width, height },
            hudHeight: width <= 600 ? 88 : 48,
            bottomPanelHeight: width <= 600 ? 178 : 132,
            eventRows,
            tutorialVisible,
            leaderboardOpen,
            leaderboardRows: 6,
            cardHeight,
            cardOpen,
            popupOpen,
            paused,
          });
          expect(validateMatchLayout(layout)).toEqual([]);
        },
      ),
    );
  });

  it('проверяет крайние содержимые состояния и все флаги', () => {
    const inputs = [
      {
        eventRows: 0,
        cardHeight: 120,
        tutorialVisible: false,
        leaderboardOpen: false,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      },
      {
        eventRows: 3,
        cardHeight: 900,
        tutorialVisible: true,
        leaderboardOpen: false,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      },
      {
        eventRows: 3,
        cardHeight: 120,
        tutorialVisible: false,
        leaderboardOpen: true,
        cardOpen: false,
        popupOpen: true,
        paused: false,
      },
      {
        eventRows: 0,
        cardHeight: 900,
        tutorialVisible: false,
        leaderboardOpen: false,
        cardOpen: true,
        popupOpen: false,
        paused: true,
      },
    ] as const;

    for (const input of inputs) {
      for (const viewport of VIEWPORTS) {
        expect(
          validateMatchLayout(
            computeMatchLayout({
              viewport,
              hudHeight: viewport.width < viewport.height ? 88 : 48,
              bottomPanelHeight: viewport.width < viewport.height ? 178 : 132,
              leaderboardRows: 6,
              ...input,
            }),
          ),
        ).toEqual([]);
      }
    }
  });
});
