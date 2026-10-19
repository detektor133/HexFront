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
  'leaderboard-open',
  'pause-menu-open',
] as const;

type MeasuredLayout = {
  readonly hudHeight: number;
  readonly bottomPanelHeight: number;
  readonly cardHeight: number;
};

const MEASURED_LAYOUT: MeasuredLayout = {
  hudHeight: 88,
  bottomPanelHeight: 150,
  cardHeight: 300,
} as const;

const SECOND_MEASURED_LAYOUT: MeasuredLayout = {
  hudHeight: 120,
  bottomPanelHeight: 200,
  cardHeight: 500,
} as const;

const LAYOUT_ELEMENT_IDS = [
  'left-column',
  'event-feed',
  'leaderboard',
  'bottom-panel',
  'card',
  'popup-menu',
  'pause-menu',
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
    element('left-column', 'left-column', 16, width < height ? 96 : 56, 160, 104),
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
    readonly eventRows?: number;
  } = {},
): Record<string, unknown> => {
  const engine = createLocalEngine(tinyMapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  engine.select(options.selectedHex ?? null);
  const snapshot = engine.snapshot();
  const selectedArmy =
    options.army ?? snapshot.view.units.find((unit) => unit.armyId !== null)?.armyId ?? null;
  const pickedUnits =
    options.pickedUnits ??
    (options.army === undefined
      ? []
      : snapshot.view.units.filter((unit) => unit.armyId === selectedArmy).map((unit) => unit.id));
  return {
    msg: snapshot,
    replay: [],
    error: null,
    picked: { hex: options.selectedHex ?? null, units: pickedUnits, target: null },
    lastReject: null,
    tool: null,
    army: options.army === undefined ? null : selectedArmy,
    fog: true,
    paused: false,
    speed: 1,
    observerId: null,
    events: Array.from({ length: options.eventRows ?? 0 }, (_, index) => ({
      id: `dom-event-${index}`,
      event: {
        t: 'commandRejected',
        playerId: 0,
        command: 'test',
        reason: 'test',
        auto: false,
      },
      hex: null,
      important: false,
      expiresAt: Number.MAX_SAFE_INTEGER,
    })),
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

function prepareDomScene(
  search = '',
  viewport: { readonly width: number; readonly height: number } = VIEWPORTS[0],
  eventRows = 0,
): void {
  window.history.replaceState({}, '', `/match${search}`);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMapJson, map: tinyMap }),
    useSandbox: () =>
      matchRuntime(
        search === '?select=0'
          ? { selectedHex: 0, eventRows }
          : search === '?army=1'
            ? { army: 1, eventRows }
            : { eventRows },
      ),
  }));
}

function installLayoutMeasurements(measurements = MEASURED_LAYOUT): void {
  class MeasuredResizeObserver {
    public observe(target: Element): void {
      const className = target.className.toString();
      const height =
        target.tagName === 'HEADER'
          ? measurements.hudHeight
          : className.includes('dock') || className.includes('content')
            ? measurements.bottomPanelHeight
            : (target.tagName === 'SECTION' && className.includes('card')) ||
                className.includes('cardBody')
              ? measurements.cardHeight
              : 0;
      this.callback(
        [
          {
            target,
            contentRect: new DOMRect(0, 0, window.innerWidth, height),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public constructor(private readonly callback: ResizeObserverCallback) {}
  }

  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
}

function readLayoutStyle(): CSSStyleDeclaration {
  const root = document.querySelector<HTMLElement>('[class*="page"]');
  if (!root) throw new Error('Корневой элемент MatchSurface не найден');
  return root.style;
}

function expectInlineRectangles(input: Parameters<typeof computeMatchLayout>[0]): void {
  const expected = computeMatchLayout(input);
  expect(readLayoutStyle().cssText).not.toContain('--layout-');
  for (const element of expected.elements) {
    const node = elementWithClass(
      element.id === 'hud'
        ? 'hud'
        : element.id === 'bottom-panel'
          ? 'dock'
          : element.id === 'leaderboard'
            ? 'panel'
            : element.id === 'card'
              ? 'card'
              : element.id === 'popup-menu'
                ? 'dialog'
                : element.id === 'pause-menu'
                  ? 'dialog'
                  : element.id === 'event-feed'
                    ? 'event-feed'
                    : element.id,
    );
    if (element.id === 'leaderboard' && node.style.left === '') {
      const edge = input.viewport.width <= 600 || input.viewport.height <= 500 ? 8 : 16;
      expect(node.style.right, element.id).toBe(`${edge}px`);
    } else if (element.id === 'card' && input.viewport.width > 600 && input.viewport.height > 500) {
      expect(node.style.width, element.id).toBe('');
      expect(node.style.height, element.id).toBe(`${element.height}px`);
    } else {
      expect(node.style.left, element.id).toBe(`${element.x}px`);
    }
    expect(node.style.top, element.id).toBe(`${element.y}px`);
    if (element.id === 'popup-menu') {
      expect(node.style.width, element.id).toBe('');
      expect(node.style.height, element.id).toBe('');
    } else if (element.id === 'leaderboard' && node.style.width === '') {
      expect(node.style.height, element.id).toBe('');
    } else {
      expect(node.style.width, element.id).toBe(`${element.width}px`);
      expect(node.style.height, element.id).toBe(`${element.height}px`);
    }
  }
  expect(validateMatchLayout(expected)).toEqual([]);
}

function elementWithClass(fragment: string): HTMLElement {
  const element =
    fragment === 'hud'
      ? document.querySelector<HTMLElement>('header')
      : fragment === 'dock'
        ? document.querySelector<HTMLElement>('[class*="dock"]')
        : fragment === 'panel'
          ? document.querySelector<HTMLElement>('[class*="panel"], [class*="collapsed"]')
          : fragment === 'card'
            ? document.querySelector<HTMLElement>('section[class*="card"]')
            : fragment === 'dialog'
              ? document.querySelector<HTMLElement>('[role="dialog"]')
              : document.querySelector<HTMLElement>(`[class*="${fragment}"]`);
  if (!element) throw new Error(`Элемент MatchSurface с классом ${fragment} не найден`);
  return element;
}

function selectorForLayoutElement(id: string): string {
  return id === 'hud'
    ? 'header'
    : id === 'bottom-panel'
      ? '[class*="dock"]'
      : id === 'leaderboard'
        ? '[class*="panel"], [class*="collapsed"]'
        : id === 'card'
          ? 'section[class*="card"]'
          : id === 'popup-menu'
            ? '[role="dialog"]:not([aria-label="Пауза"])'
            : id === 'pause-menu'
              ? '[role="dialog"][aria-label="Пауза"]'
              : `[class*="${id}"]`;
}

function expectRenderedRectangles(input: Parameters<typeof computeMatchLayout>[0]): void {
  const expected = computeMatchLayout(input);
  const expectedIds = new Set(expected.elements.map((element) => element.id));
  const rendered = new Map<string, HTMLElement>();
  for (const element of expected.elements) {
    const fragment =
      element.id === 'hud'
        ? 'hud'
        : element.id === 'bottom-panel'
          ? 'dock'
          : element.id === 'leaderboard'
            ? 'panel'
            : element.id === 'card'
              ? 'card'
              : element.id === 'popup-menu' || element.id === 'pause-menu'
                ? 'dialog'
                : element.id === 'event-feed'
                  ? 'event-feed'
                  : element.id;
    const node = elementWithClass(fragment);
    rendered.set(element.id, node);
    expect(getComputedStyle(node).display, element.id).not.toBe('none');
    expect(getComputedStyle(node).visibility, element.id).not.toBe('hidden');
  }
  for (const id of LAYOUT_ELEMENT_IDS) {
    if (!expectedIds.has(id)) {
      expect(document.querySelector(selectorForLayoutElement(id)), id).toBeNull();
    }
  }
  for (const element of expected.elements) {
    const node = rendered.get(element.id);
    if (!node) throw new Error(`Прямоугольник ${element.id} не отрендерен`);
    expect(node.isConnected, element.id).toBe(true);
    expect(
      {
        x: element.id === 'leaderboard' && node.style.left === '' ? '' : node.style.left,
        y: node.style.top,
        width: element.id === 'popup-menu' ? '' : node.style.width,
        height: element.id === 'popup-menu' ? '' : node.style.height,
      },
      element.id,
    ).toEqual({
      x: element.id === 'leaderboard' && node.style.left === '' ? '' : `${element.x}px`,
      y: `${element.y}px`,
      width:
        element.id === 'popup-menu' ||
        (element.id === 'leaderboard' && node.style.width === '') ||
        (element.id === 'card' && input.viewport.width > 600 && input.viewport.height > 500)
          ? ''
          : `${element.width}px`,
      height:
        element.id === 'popup-menu' || (element.id === 'leaderboard' && node.style.height === '')
          ? ''
          : `${element.height}px`,
    });
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
      element('left-column', 'left-column', 16, 96, 260, 48),
      element('leaderboard', 'leaderboard', 16, 120, 260, 48),
    ];

    expect(validateMatchLayout(layout)).toContainEqual(
      expect.objectContaining({ type: 'overlap', elements: ['left-column', 'leaderboard'] }),
    );
  });

  it('критерий 2: отклоняет интерактивный элемент меньше 44×44 px и текст мельче 12 px', () => {
    const layout = validLayout(390, 844);
    layout.elements = [
      element('tax', 'popup-menu', 10, 100, 43, 44, { interactive: true }),
      element('small-label', 'left-column', 10, 160, 100, 20, { fontSize: 11 }),
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

  it('критерий 5: вычисляет пять сцен для трёх размеров', () => {
    const sceneInputs: Record<
      (typeof REAL_SCENES)[number],
      Omit<
        Parameters<typeof computeMatchLayout>[0],
        'viewport' | 'hudHeight' | 'bottomPanelHeight' | 'leaderboardRows'
      >
    > = {
      'start-with-tutorial': {
        eventRows: 0,
        cardHeight: 303,
        tutorialVisible: true,
        leaderboardOpen: false,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      },
      'selected-hex': {
        eventRows: 3,
        cardHeight: 303,
        tutorialVisible: false,
        leaderboardOpen: false,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      },
      'selected-army': {
        eventRows: 0,
        cardHeight: 303,
        tutorialVisible: false,
        leaderboardOpen: false,
        cardOpen: true,
        popupOpen: false,
        paused: false,
      },
      'leaderboard-open': {
        eventRows: 3,
        cardHeight: 303,
        tutorialVisible: false,
        leaderboardOpen: true,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      },
      'pause-menu-open': {
        eventRows: 0,
        cardHeight: 303,
        tutorialVisible: false,
        leaderboardOpen: false,
        cardOpen: false,
        popupOpen: false,
        paused: true,
      },
    };
    for (const scene of REAL_SCENES) {
      for (const viewport of VIEWPORTS) {
        const layout = computeMatchLayout({
          viewport,
          hudHeight: viewport.width < viewport.height ? 88 : 48,
          bottomPanelHeight: viewport.width < viewport.height ? 178 : 132,
          leaderboardRows: 6,
          ...sceneInputs[scene],
        });
        expect(layout.scene).toBe(scene);
        expect(validateMatchLayout(layout)).toEqual([]);
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
    const forbidden =
      /(?<!-)\b(?:top|right|bottom|left|max-height|width)\s*:\s*-?\d+(?:\.\d+)?px\b/g;
    for (const relativePath of floatingModules) {
      const source = readFileSync(join(clientSourceDirectory, relativePath), 'utf8');
      const violations = source
        .split(/\r?\n/)
        .flatMap((line) => (line.trimStart().startsWith('@') ? [] : (line.match(forbidden) ?? [])));
      expect(violations, relativePath).toEqual([]);
    }

    const hudSource = readFileSync(join(clientSourceDirectory, 'dev', 'Hud.module.css'), 'utf8');
    expect(hudSource).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.taxButton \{[\s\S]*?min-height: var\(--touch-target-min\)/,
    );
  });

  it('передаёт измеренные прямоугольники через реальный MatchSurface', async () => {
    installLayoutMeasurements(MEASURED_LAYOUT);
    prepareDomScene('?select=0');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(createElement(MatchPage));

    expectInlineRectangles({
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
    expectRenderedRectangles({
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

  it.each([
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [390, 844],
    [844, 390],
  ] as const)(
    'монтирует EventFeed и выдерживает геометрию на viewport %ix%i',
    async (width, height) => {
      installLayoutMeasurements();
      for (const eventRows of [1, 2, 3]) {
        cleanup();
        vi.resetModules();
        prepareDomScene('', { width, height }, eventRows);
        const { MatchPage } = await import('../src/match/MatchPage.tsx');

        render(createElement(MatchPage));

        const feed = screen.getByLabelText(/Лента событий|Event feed/u);
        const dock = elementWithClass('dock');
        const edge = width <= 600 || height <= 500 ? 8 : 16;
        const gap = 8;
        const feedRight =
          Number.parseInt(feed.style.left, 10) + Number.parseInt(feed.style.width, 10);
        const feedBottom =
          Number.parseInt(feed.style.top, 10) + Number.parseInt(feed.style.height, 10);
        const dockTop = Number.parseInt(dock.style.top, 10);

        expect(feed.getAttribute('aria-label')).toMatch(/Лента событий|Event feed/u);
        expect(feed.querySelectorAll('button')).toHaveLength(eventRows);
        expect(feedRight).toBe(width - edge);
        expect(feedBottom).toBe(dockTop - gap);
        expect(feed.style.height).toBe(`${eventRows * 44}px`);
        expect(Number.parseInt(feed.style.left, 10)).toBeGreaterThanOrEqual(0);
        expect(Number.parseInt(feed.style.top, 10)).toBeGreaterThanOrEqual(0);
        expect(feedRight).toBeLessThanOrEqual(width);
        expect(feedBottom).toBeLessThanOrEqual(height);
      }
    },
  );

  it('проверяет второй набор измерений через реальный MatchSurface', async () => {
    installLayoutMeasurements(SECOND_MEASURED_LAYOUT);
    prepareDomScene('?select=0');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    expectInlineRectangles({
      viewport: VIEWPORTS[0],
      ...SECOND_MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
    expectRenderedRectangles({
      viewport: VIEWPORTS[0],
      ...SECOND_MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
  });

  it('отдельно рендерит выбранную армию без карточки отряда', async () => {
    installLayoutMeasurements();
    prepareDomScene('?army=1');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));

    expect(elementWithClass('dock')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expectRenderedRectangles({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
  });

  it('показывает лидерборд в раскладке без отдельного открытия на ПК', async () => {
    installLayoutMeasurements();
    prepareDomScene('', VIEWPORTS[2]);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    expect(
      screen.queryByRole('region', { name: /Таблица лидеров|Leaderboard/u }) ??
        screen.queryByRole('button', { name: /Таблица лидеров|Leaderboard/u }),
    ).toBeTruthy();
    const leaderboard = screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u });
    expect(leaderboard.style.width).toBe('');
    expect(leaderboard.style.height).toBe('');
    expect(
      readFileSync(join(process.cwd(), 'apps/client/src/dev/Leaderboard.module.css'), 'utf8'),
    ).toMatch(/\.panel\s*\{[\s\S]*width:\s*max-content/u);
    expectInlineRectangles({
      viewport: VIEWPORTS[2],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
    expectRenderedRectangles({
      viewport: VIEWPORTS[2],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
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
    expectInlineRectangles({
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
    expectRenderedRectangles({
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

  it('не рендерит карточку, исключённую расчётом при открытии меню налога', async () => {
    installLayoutMeasurements();
    prepareDomScene('?select=0');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));

    expectRenderedRectangles({
      viewport: VIEWPORTS[0],
      ...MEASURED_LAYOUT,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardOpen: true,
      popupOpen: true,
      paused: false,
    });
    expect(document.querySelector('section[class*="card"]')).toBeNull();
  });

  it('передаёт состояние паузы в расчёт после клика по реальному HUD', async () => {
    installLayoutMeasurements();
    prepareDomScene();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    fireEvent.click(screen.getByRole('button', { name: /Пауза|Pause/u }));
    expect(screen.getByRole('dialog', { name: /Пауза|Pause/u })).not.toBeNull();
    expectInlineRectangles({
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
    expectRenderedRectangles({
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

  it('обновляет desktop-координату лидерборда после DOM-измерения панели', async () => {
    installLayoutMeasurements();
    prepareDomScene('', VIEWPORTS[2]);
    let panelRect = {
      x: 1274,
      y: 56,
      width: 150,
      height: 138,
      top: 56,
      right: 1424,
      bottom: 194,
      left: 1274,
    };
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.className.toString().includes('panel')) {
        return { ...panelRect, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    });
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(createElement(MatchPage));
    const leaderboard = await screen.findByRole('region', {
      name: /Таблица лидеров|Leaderboard/u,
    });

    expect(leaderboard.style.right).toBe('');
    expect(leaderboard.style.left).toBe('1274px');
    expect(leaderboard.style.width).toBe('');
    expect(leaderboard.style.height).toBe('');

    cleanup();
    panelRect = {
      x: 1250,
      y: 54,
      width: 174,
      height: 142,
      top: 54,
      right: 1424,
      bottom: 196,
      left: 1250,
    };
    render(createElement(MatchPage));
    const resizedLeaderboard = await screen.findByRole('region', {
      name: /Таблица лидеров|Leaderboard/u,
    });

    expect(resizedLeaderboard.style.left).toBe('1250px');
    expect(resizedLeaderboard.style.width).toBe('');
    expect(resizedLeaderboard.style.height).toBe('');
    expect(resizedLeaderboard.style.left).not.toBe(leaderboard.style.left);
  });
});
