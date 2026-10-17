import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { computeMatchLayout } from '../src/match/layout.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, MapViewState, TapKind } from '../src/render/map-view.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));
const loadedMap = mapResult.map;

interface ResizeStats {
  dockObserves: number;
  dockDisconnects: number;
}

function installResizeObserver(stats: ResizeStats): void {
  class TestResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      const isDock = target.className.toString().includes('dock');
      if (isDock) stats.dockObserves += 1;
      Object.defineProperty(target, 'scrollHeight', {
        configurable: true,
        value: isDock ? 150 : 88,
      });
      this.callback(
        [{ target, contentRect: { height: isDock ? 120 : 88 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    public disconnect(): void {
      stats.dockDisconnects += 1;
    }
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

function installMatchMocks(engine: ReturnType<typeof createLocalEngine>): {
  getTap: () => ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
} {
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  let tap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
  const emit = (onMessage: (message: FromWorker) => void): void => onMessage(engine.snapshot());

  vi.doMock('../src/local/local-match.ts', () => ({
    startLocalMatch: (
      _map: unknown,
      _seed: number,
      _setup: unknown,
      onMessage: (message: FromWorker) => void,
    ): LocalMatch => {
      emit(onMessage);
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
          emit(onMessage);
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
  return { getTap: () => tap };
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

function expectedPanelStyle(width: number, height: number): string[] {
  const layout = computeMatchLayout({
    viewport: { width, height },
    hudHeight: 88,
    bottomPanelHeight: 150,
    eventRows: 0,
    tutorialVisible: true,
    leaderboardOpen: width > 600,
    leaderboardRows: 2,
    cardHeight: 0,
    cardOpen: false,
    popupOpen: false,
    paused: false,
  });
  const element = layout.elements.find((item) => item.id === 'bottom-panel');
  if (!element) throw new Error('нижняя панель не попала в раскладку');
  return [element.x, element.y, element.width, element.height].map((value) => `${value}px`);
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
      const stats: ResizeStats = { dockObserves: 0, dockDisconnects: 0 };
      installResizeObserver(stats);
      const engine = createLocalEngine(mapJson, 42, 2);
      const firstHex =
        'errors' in engine ? undefined : engine.state.cities.find((city) => city.owner === 0)?.hex;
      const secondHex =
        'errors' in engine ? undefined : engine.state.cities.find((city) => city.owner === 1)?.hex;
      if (firstHex === undefined || secondHex === undefined)
        throw new Error('города для выбора не найдены');
      const { getTap } = installMatchMocks(engine);
      const { MatchPage } = await import('../src/match/MatchPage.tsx');

      render(<MatchPage />);
      await waitFor(() => expect(getTap()).toBeDefined());
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height)));
      const before = panelStyle();
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);
      expect(getComputedStyle(panel()).paddingBottom).toBe('var(--space-sm)');
      expect(getComputedStyle(panel()).paddingLeft).toBe('var(--space-lg)');
      expect(document.querySelector('[class*="strip"]')).not.toBeNull();
      const strip = document.querySelector<HTMLElement>('[class*="strip"]');
      if (!strip) throw new Error('лента армий не найдена');
      expect(getComputedStyle(strip).overflowX).toBe('auto');
      expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Резерв' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Автопополнение' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Новая армия' })).toBeTruthy();

      const tap = getTap();
      if (!tap) throw new Error('обработчик карты не установлен');
      const select = async (hex: number): Promise<void> => {
        const point = hexFromId(hex, loadedMap.width);
        act(() => tap(point, 'select', { x: 0, y: 0 }));
        await waitFor(() =>
          expect(document.querySelector('section[class*="card"]')).not.toBeNull(),
        );
      };
      await select(firstHex);
      expect(panelStyle()).toEqual(before);
      expect(stats.dockObserves).toBe(1);
      await select(secondHex);
      expect(panelStyle()).toEqual(before);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(document.querySelector('section[class*="card"]')).toBeNull());
      expect(panelStyle()).toEqual(before);
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);
    },
  );

  it('убирает ArmyBar на время открытого налога и возвращает её с теми же координатами', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const stats: ResizeStats = { dockObserves: 0, dockDisconnects: 0 };
    installResizeObserver(stats);
    const engine = createLocalEngine(mapJson, 42, 2);
    const { getTap } = installMatchMocks(engine);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    await waitFor(() => expect(getTap()).toBeDefined());
    await waitFor(() => expect(panel()).toBeTruthy());
    const before = panelStyle();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(document.querySelector('[class*="dock"]')).toBeNull());
    expect(screen.getByRole('slider', { name: 'Налог' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(panelStyle()).toEqual(before));
    expect(stats.dockObserves).toBe(2);
    expect(stats.dockDisconnects).toBeGreaterThanOrEqual(1);
  });
});
