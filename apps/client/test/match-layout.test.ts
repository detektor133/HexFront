// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import {
  computeMatchLayout,
  validateMatchLayout,
  type MatchLayoutElement,
  type MatchLayoutSnapshot,
} from '../src/match/layout.ts';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
] as const;

const tinyMapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const parsedMap = loadMap(tinyMapJson);
if (!parsedMap.ok) throw new Error(parsedMap.errors.join('; '));
const tinyMap = parsedMap.map;

const REAL_SCENES = [
  'start-with-tutorial',
  'selected-hex',
  'selected-army',
  'pause-menu-open',
] as const;

const MEASURED_LAYOUT = {
  hudHeight: 88,
  bottomPanelHeight: 150,
  cardHeight: 300,
} as const;

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

function prepareDomScene(search = '', viewport = VIEWPORTS[0]): void {
  window.history.replaceState({}, '', `/match${search}`);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMapJson, map: tinyMap }),
    useSandbox: () => matchRuntime(search === '?select=0' ? { selectedHex: 0 } : {}),
  }));
}

function installLayoutMeasurements(): void {
  class MeasuredResizeObserver {
    public observe(target: Element): void {
      this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public constructor(private readonly callback: ResizeObserverCallback) {}
  }

  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const className = this.className.toString();
    const height =
      this.tagName === 'HEADER'
        ? MEASURED_LAYOUT.hudHeight
        : className.includes('dock')
          ? MEASURED_LAYOUT.bottomPanelHeight
          : className.includes('card')
            ? MEASURED_LAYOUT.cardHeight
            : 0;
    return new DOMRect(0, 0, window.innerWidth, height);
  });
}

function readLayoutStyle(): CSSStyleDeclaration {
  const root = document.querySelector<HTMLElement>('[class*="page"]');
  if (!root) throw new Error('Корневой элемент MatchSurface не найден');
  return root.style;
}

function expectLayoutVariables(input: Parameters<typeof computeMatchLayout>[0]): void {
  const expected = computeMatchLayout(input);
  const style = readLayoutStyle();
  for (const element of expected.elements) {
    expect(style.getPropertyValue(`--layout-${element.id}-x`)).toBe(`${element.x}px`);
    expect(style.getPropertyValue(`--layout-${element.id}-y`)).toBe(`${element.y}px`);
    expect(style.getPropertyValue(`--layout-${element.id}-width`)).toBe(`${element.width}px`);
    expect(style.getPropertyValue(`--layout-${element.id}-height`)).toBe(`${element.height}px`);
  }
  expect(validateMatchLayout(expected)).toEqual([]);
}

afterEach(() => {
  cleanup();
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
    const clientSourceDirectory = join(process.cwd(), 'apps/client/src');
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

  it('передаёт измеренные прямоугольники через реальный MatchSurface', async () => {
    installLayoutMeasurements();
    prepareDomScene('?select=0');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));

    expectLayoutVariables({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
  });

  it('пересчитывает раскладку после открытия лидерборда', async () => {
    installLayoutMeasurements();
    prepareDomScene();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    fireEvent.click(screen.getByRole('button', { name: /Таблица лидеров|Leaderboard/u }));
    expectLayoutVariables({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: true,
      leaderboardRows: 2,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
  });

  it('пересчитывает раскладку после открытия меню налога', async () => {
    installLayoutMeasurements();
    prepareDomScene();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));
    expect(screen.getByRole('dialog', { name: /Налог|Tax/u })).not.toBeNull();
    expectLayoutVariables({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: false,
      popupOpen: true,
      paused: false,
    });
  });

  it('передаёт состояние паузы в расчёт после клика по реальному HUD', async () => {
    installLayoutMeasurements();
    prepareDomScene();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    fireEvent.click(screen.getByRole('button', { name: /Пауза|Pause/u }));
    expect(screen.getByRole('dialog', { name: /Пауза|Pause/u })).not.toBeNull();
    expectLayoutVariables({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: false,
      popupOpen: false,
      paused: true,
    });
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
