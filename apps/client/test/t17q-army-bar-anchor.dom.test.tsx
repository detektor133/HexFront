import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { computeMatchLayout } from '../src/match/layout.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, MapViewState, TapKind } from '../src/render/map-view.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const fivePlayerMapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));
const loadedMap = mapResult.map;

interface ResizeStats {
  dockObserves: number;
  dockDisconnects: number;
  dockCallbacks: number;
  observers: Array<{
    kind: 'dock' | 'card';
    target: Element;
    callback: ResizeObserverCallback;
    observer: ResizeObserver;
  }>;
}

function installResizeObserver(stats: ResizeStats): void {
  class TestResizeObserver {
    private isDock = false;

    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      const isDock = target.className.toString().includes('content');
      this.isDock = isDock;
      if (isDock) stats.dockObserves += 1;
      Object.defineProperty(target, 'scrollHeight', {
        configurable: true,
        get: () => {
          const assignedHeight = Number.parseFloat((target as HTMLElement).style.height);
          return (isDock ? 150 : 88) + (Number.isNaN(assignedHeight) ? 0 : assignedHeight);
        },
      });
      const contentHeight = isDock ? 120 : 88;
      const observer = this as unknown as ResizeObserver;
      stats.observers.push({
        kind: isDock ? 'dock' : 'card',
        target,
        callback: this.callback,
        observer,
      });
      if (isDock) stats.dockCallbacks += 1;
      this.callback(
        [{ target, contentRect: { height: contentHeight } } as ResizeObserverEntry],
        observer,
      );
    }

    public disconnect(): void {
      if (this.isDock) stats.dockDisconnects += 1;
    }
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

function reportHeight(
  stats: ResizeStats,
  kind: 'dock' | 'card',
  contentHeight: number,
  scrollHeight: number,
): void {
  const record = [...stats.observers].reverse().find((item) => item.kind === kind);
  if (!record) throw new Error(`ResizeObserver для ${kind} не найден`);
  Object.defineProperty(record.target, 'scrollHeight', { configurable: true, value: scrollHeight });
  if (kind === 'dock') stats.dockCallbacks += 1;
  record.callback(
    [{ target: record.target, contentRect: { height: contentHeight } } as ResizeObserverEntry],
    record.observer,
  );
}

function installMatchMocks(
  engine: LocalEngine,
  matchMap: unknown = mapJson,
): {
  getTap: () => ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
  emit: () => void;
} {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => matchMap,
    })),
  );
  let tap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
  let onMessage: ((message: FromWorker) => void) | undefined;
  const emit = (): void => onMessage?.(engine.snapshot());

  vi.doMock('../src/local/local-match.ts', () => ({
    startLocalMatch: (
      _map: unknown,
      _seed: number,
      _setup: unknown,
      messageHandler: (message: FromWorker) => void,
    ): LocalMatch => {
      onMessage = messageHandler;
      emit();
      return {
        send: vi.fn(),
        setFog: vi.fn(),
        setPaused: vi.fn(),
        step: vi.fn(),
        setSpeed: vi.fn(),
        setObserver: vi.fn(),
        setView: vi.fn(),
        select: (hex) => {
          engine.select(hex);
          emit();
        },
        ack: vi.fn(),
        dispose: vi.fn(),
      };
    },
  }));
  vi.doMock('../src/render/map-view.ts', () => ({
    createMapView: async (
      _host: HTMLElement,
      _map: typeof loadedMap,
      _options: MapViewOptions,
      _onState: (state: MapViewState) => void,
      onTap?: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
    ): Promise<MapView> => {
      tap = onTap;
      return {
        configure: vi.fn(),
        setScale: vi.fn(),
        setBottomInset: vi.fn(),
        setTopInset: vi.fn(),
        centerOn: vi.fn(),
        setStroke: vi.fn(),
        setSelection: vi.fn(),
        setGrab: vi.fn(),
        setOrderHooks: vi.fn(),
        cancel: vi.fn(),
        sceneStats: () => ({
          objects: 0,
          text: 0,
          graphics: 0,
          graphicsInstructions: [],
          graphicsDetails: [],
          textures: 0,
          canvasTextTextures: null,
        }),
        destroy: vi.fn(),
      };
    },
  }));
  return { getTap: () => tap, emit };
}

function requireLocalEngine(engine: ReturnType<typeof createLocalEngine>): LocalEngine {
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  return engine;
}

function panel(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[class*="dock"]');
  if (!element) throw new Error('панель армий не найдена');
  return element;
}

function panelStyle(): string[] {
  return ['left', 'top', 'width', 'height'].map((property) =>
    panel().style.getPropertyValue(property),
  );
}

function expectedPanelStyle(
  width: number,
  height: number,
  bottomPanelHeight = 150,
  cardHeight = 0,
  leaderboardRows = 2,
  popupOpen = false,
): string[] {
  const layout = computeMatchLayout({
    viewport: { width, height },
    hudHeight: 88,
    bottomPanelHeight,
    eventRows: 0,
    tutorialVisible: true,
    leaderboardOpen: width > 600,
    leaderboardRows,
    cardHeight,
    cardOpen: cardHeight > 0,
    popupOpen,
    paused: false,
  });
  const element = layout.elements.find((item) => item.id === 'bottom-panel');
  if (!element) throw new Error('нижняя панель не попала в раскладку');
  return [element.x, element.y, element.width, element.height].map((value) => `${value}px`);
}

function expectDockPadding(): void {
  const style = getComputedStyle(panel());
  const strip = panel().querySelector<HTMLElement>('[class*="strip"]');
  if (!strip) throw new Error('Лента армий не найдена');
  const stripStyle = getComputedStyle(strip);
  const source = readFileSync('apps/client/src/dev/ArmyBar.module.css', 'utf8');
  expect(source).toMatch(/padding: 0 var\(--space-lg\) var\(--space-sm\);/u);
  expect(source).toMatch(/padding: 0 var\(--space-sm\) var\(--space-sm\);/u);
  if (style.paddingBottom !== '0') expect(style.paddingBottom).toBe('var(--space-sm)');
  if (style.paddingLeft !== '0') expect(style.paddingLeft).toBe('var(--space-lg)');
  if (stripStyle.marginBottom !== '0') expect(stripStyle.marginBottom).toBe('var(--space-sm)');
  const tokens = readFileSync('docs/art/tokens.json', 'utf8');
  const spaceSm = Number.parseInt(tokens.match(/"sm":\s*(\d+)/u)?.[1] ?? '', 10);
  const spaceLg = Number.parseInt(tokens.match(/"lg":\s*(\d+)/u)?.[1] ?? '', 10);
  expect(spaceSm + spaceSm).toBe(spaceLg);
  expect(source).toMatch(/\.strip\s*\{[\s\S]*?margin-bottom: var\(--space-sm\);/u);
  expect(readFileSync('docs/art/tokens.json', 'utf8')).toMatch(/"lg": 16/u);
  expect(readFileSync('docs/art/tokens.json', 'utf8')).toMatch(/"sm": 8/u);
  expect(source).not.toMatch(/position:\s*fixed/u);
}

function expectElementStyle(
  elementId: string,
  input: Parameters<typeof computeMatchLayout>[0],
): void {
  const element = computeMatchLayout(input).elements.find((item) => item.id === elementId);
  if (!element) throw new Error(`элемент раскладки ${elementId} не найден`);
  const node =
    elementId === 'card'
      ? document.querySelector<HTMLElement>('section[class*="card"]')
      : document.querySelector<HTMLElement>('[class*="dock"]');
  if (!node) throw new Error(`DOM-элемент ${elementId} не найден`);
  expect(
    ['left', 'top', 'width', 'height'].map((property) => node.style.getPropertyValue(property)),
  ).toEqual([element.x, element.y, element.width, element.height].map((value) => `${value}px`));
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('07/T17q: нижняя привязка ArmyBar', () => {
  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])(
    'монтирует реальный MatchPage %dx%d, сохраняет координаты и измеряет ArmyBar один раз',
    async (width, height) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      const stats: ResizeStats = {
        dockObserves: 0,
        dockDisconnects: 0,
        dockCallbacks: 0,
        observers: [],
      };
      installResizeObserver(stats);
      const engine = requireLocalEngine(createLocalEngine(mapJson, 42, 2));
      const firstHex = engine.state.cities.find((city) => city.owner === 0)?.hex;
      const secondHex = engine.state.cities.find((city) => city.owner === 1)?.hex;
      if (firstHex === undefined || secondHex === undefined)
        throw new Error('города для выбора не найдены');
      const { getTap, emit } = installMatchMocks(engine);
      const { MatchPage } = await import('../src/match/MatchPage.tsx');

      const { unmount } = render(<MatchPage />);
      await waitFor(() => expect(getTap()).toBeDefined());
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height)));
      const before = panelStyle();
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);
      expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(1);
      expect(
        stats.observers.find((item) => item.kind === 'dock')?.target.className.toString(),
      ).toContain('content');
      const armyBar = panel();
      const armyBarStyle = panelStyle();
      expectDockPadding();
      for (const leaderboardRows of [2, 5]) {
        for (const cardHeight of [88, 160]) {
          expect(expectedPanelStyle(width, height, 150, cardHeight, leaderboardRows)).toEqual(
            before,
          );
        }
      }
      expect(document.querySelector('[class*="strip"]')).not.toBeNull();
      const strip = document.querySelector<HTMLElement>('[class*="strip"]');
      if (!strip) throw new Error('лента армий не найдена');
      const stripStyle = getComputedStyle(strip).overflowX;
      if (stripStyle !== 'visible') expect(stripStyle).toBe('auto');
      else
        expect(readFileSync('apps/client/src/dev/ArmyBar.module.css', 'utf8')).toMatch(
          /overflow-x: auto;/u,
        );
      expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Резерв' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Автопополнение' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Новая армия' })).toBeTruthy();
      const leaderboard =
        width > 600 ? document.querySelector<HTMLElement>('section[aria-label]') : null;
      if (width > 600 && !leaderboard) throw new Error('лидерборд не найден');
      const leaderboardStyle = leaderboard?.getAttribute('style');

      const tap = getTap();
      if (!tap) throw new Error('обработчик карты не установлен');
      const select = async (hex: number): Promise<void> => {
        const point = hexFromId(hex, loadedMap.width);
        act(() => tap(point, 'select', { x: 100, y: 100 }));
        act(() => tap(point, 'select', { x: 100, y: 100 }));
        expect(engine.snapshot().selection?.hex).toBe(hex);
        await waitFor(() =>
          expect(document.querySelector('section[class*="card"]')).not.toBeNull(),
        );
      };
      await select(firstHex);
      expect(panelStyle()).toEqual(armyBarStyle);
      const renderedCard = document.querySelector<HTMLElement>('section[class*="card"]');
      if (!renderedCard) throw new Error('карточка клетки не найдена');
      expectElementStyle('card', {
        viewport: { width, height },
        hudHeight: 88,
        bottomPanelHeight: Number.parseFloat(panel().style.height),
        eventRows: 0,
        tutorialVisible: true,
        leaderboardOpen: width > 600,
        leaderboardRows: 2,
        cardHeight: Number.parseFloat(renderedCard.style.height),
        cardOpen: true,
        popupOpen: false,
        paused: false,
      });
      if (width > 600) {
        expect(
          document.querySelector<HTMLElement>('section[aria-label]')?.getAttribute('style'),
        ).toBe(leaderboardStyle);
      }
      expect(stats.observers.some((item) => item.kind === 'card')).toBe(true);
      expect(stats.dockObserves).toBe(1);
      const firstArmy = engine.state.armies.find((army) => army.owner === 0);
      if (!firstArmy) throw new Error('Армия владельца не найдена');
      firstArmy.name = 'Обновлённая армия';
      act(emit);
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: 'Обновлённая армия' }).length).toBeGreaterThan(
          0,
        ),
      );
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(panel()).toBe(armyBar);
      expect(panelStyle()).toEqual(armyBarStyle);
      expectDockPadding();
      expect(stats.dockObserves).toBe(1);
      firstArmy.name = '1-я армия';
      act(emit);
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0),
      );
      const armyButton = screen.getAllByRole('button', { name: '1-я армия' })[0];
      if (!armyButton) throw new Error('карточка первой армии не найдена');
      fireEvent.click(armyButton);
      expect(panelStyle()).toEqual(before);
      for (const cardHeight of [88, 160]) {
        act(() => reportHeight(stats, 'card', cardHeight, cardHeight));
        await waitFor(() =>
          expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 150, cardHeight)),
        );
      }
      await select(secondHex);
      expect(panelStyle()).toEqual(before);
      if (width > 600) {
        expect(
          document.querySelector<HTMLElement>('section[aria-label]')?.getAttribute('style'),
        ).toBe(leaderboardStyle);
      }
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(document.querySelector('section[class*="card"]')).toBeNull());
      expect(panelStyle()).toEqual(before);
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);

      act(() => reportHeight(stats, 'dock', 180, 200));
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 200)));
      const afterResize = panelStyle();
      act(() => reportHeight(stats, 'dock', 160, 220));
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 220)));
      const afterSecondResize = panelStyle();
      const callbacksBeforeRepeat = stats.dockCallbacks;
      act(() => reportHeight(stats, 'dock', 160, 220));
      await waitFor(() => expect(panelStyle()).toEqual(afterSecondResize));
      expect(afterResize).not.toEqual(afterSecondResize);
      expect(stats.dockCallbacks).toBe(callbacksBeforeRepeat + 1);
      expect(stats.dockObserves).toBe(1);
      unmount();
      expect(stats.dockDisconnects).toBe(1);
    },
  );

  it('сохраняет привязку при пяти строках реального лидерборда', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const stats: ResizeStats = {
      dockObserves: 0,
      dockDisconnects: 0,
      dockCallbacks: 0,
      observers: [],
    };
    installResizeObserver(stats);
    const engine = requireLocalEngine(createLocalEngine(fivePlayerMapJson, 42, 5));
    const { getTap } = installMatchMocks(engine, fivePlayerMapJson);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    const { unmount } = render(<MatchPage />);
    await waitFor(() => expect(getTap()).toBeDefined());
    await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(1440, 900, 150, 0, 5)));
    expect(screen.getByText('Живы: 5')).toBeTruthy();
    expect(stats.dockObserves).toBe(1);
    for (const cardHeight of [88, 160]) {
      act(() => reportHeight(stats, 'card', cardHeight, cardHeight));
      await waitFor(() =>
        expect(panelStyle()).toEqual(expectedPanelStyle(1440, 900, 150, cardHeight, 5)),
      );
    }
    unmount();
    expect(stats.dockDisconnects).toBe(1);
  });

  it('убирает ArmyBar на время открытого налога и возвращает её с теми же координатами', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const stats: ResizeStats = {
      dockObserves: 0,
      dockDisconnects: 0,
      dockCallbacks: 0,
      observers: [],
    };
    installResizeObserver(stats);
    const engine = requireLocalEngine(createLocalEngine(mapJson, 42, 2));
    const { getTap } = installMatchMocks(engine);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    const { unmount } = render(<MatchPage />);
    await waitFor(() => expect(getTap()).toBeDefined());
    await waitFor(() => expect(panel()).toBeTruthy());
    expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(1);
    const before = panelStyle();
    expect(
      computeMatchLayout({
        viewport: { width: 1440, height: 900 },
        hudHeight: 88,
        bottomPanelHeight: 150,
        eventRows: 0,
        tutorialVisible: true,
        leaderboardOpen: true,
        leaderboardRows: 2,
        cardHeight: 88,
        cardOpen: true,
        popupOpen: true,
        paused: false,
      }).elements.some((item) => item.id === 'bottom-panel'),
    ).toBe(false);
    for (const cardHeight of [88, 160]) {
      for (const leaderboardRows of [2, 5]) {
        expect(expectedPanelStyle(1440, 900, 150, cardHeight, leaderboardRows)).toEqual(before);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(document.querySelector('[class*="dock"]')).toBeNull());
    expect(screen.getByRole('slider', { name: 'Налог' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(panelStyle()).toEqual(before));
    expect(stats.dockObserves).toBe(2);
    expect(stats.dockDisconnects).toBeGreaterThanOrEqual(1);
    expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(2);
    unmount();
    expect(stats.dockDisconnects).toBe(2);
  });

  it.each([
    [1440, 900],
    [1920, 1080],
  ])(
    'сохраняет границы карточки при двух высотах и двух размерах лидерборда (%dx%d)',
    (width, height) => {
      for (const leaderboardRows of [2, 5]) {
        for (const cardHeight of [88, 160]) {
          const layout = computeMatchLayout({
            viewport: { width, height },
            hudHeight: 88,
            bottomPanelHeight: 150,
            eventRows: 0,
            tutorialVisible: true,
            leaderboardOpen: true,
            leaderboardRows,
            cardHeight,
            cardOpen: true,
            popupOpen: false,
            paused: false,
          });
          const dock = layout.elements.find((item) => item.id === 'bottom-panel');
          const card = layout.elements.find((item) => item.id === 'card');
          expect(dock).toBeDefined();
          expect(card).toBeDefined();
          if (!dock || !card) continue;
          expect(card.y + card.height).toBeLessThanOrEqual(dock.y - 8);
          expect(card.y + card.height).toBeLessThanOrEqual(height);
          expect(dock.y + dock.height).toBeLessThanOrEqual(height);
        }
      }
    },
  );

  it('не ограничивает обычный ПК правилом телефонного альбома', () => {
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: 88,
        bottomPanelHeight: 1000,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 0,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      });
      expect(layout.bottomPanelHeight).toBe(viewport.height - 88 - 8);
    }
  });
});
