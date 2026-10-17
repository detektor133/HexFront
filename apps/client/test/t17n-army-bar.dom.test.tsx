import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, MapViewState, TapKind } from '../src/render/map-view.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('07/T17n: панель армий при карточке клетки', () => {
  it('сохраняет раскладку панели при выборе, смене и снятии выбора гекса', async () => {
    let tap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
    let dockObserves = 0;
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const firstHex = engine.state.cities.find((city) => city.owner === 0)?.hex;
    const secondHex = engine.state.cities.find((city) => city.owner === 1)?.hex;
    if (firstHex === undefined || secondHex === undefined) {
      throw new Error('города для выбора не найдены');
    }
    const emit = (onMessage: (message: FromWorker) => void): void => onMessage(engine.snapshot());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _players: unknown,
        onMessage: (message: FromWorker) => void,
      ): LocalMatch => {
        emit(onMessage);
        return {
          send: () => undefined,
          setFog: () => undefined,
          setPaused: () => undefined,
          step: () => undefined,
          setSpeed: () => undefined,
          setObserver: () => undefined,
          setView: () => undefined,
          select: (hex) => {
            engine.select(hex);
            emit(onMessage);
          },
          ack: () => undefined,
          dispose: () => undefined,
        };
      },
    }));
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        _map: typeof mapResult.map,
        _initial: MapViewOptions,
        _onState: (state: MapViewState) => void,
        onTap?: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
      ): Promise<MapView> => {
        tap = onTap;
        return {
          configure: () => undefined,
          setScale: () => undefined,
          setBottomInset: () => undefined,
          setTopInset: () => undefined,
          centerOn: () => undefined,
          setStroke: () => undefined,
          setSelection: () => undefined,
          setGrab: () => undefined,
          setOrderHooks: () => undefined,
          cancel: () => undefined,
          sceneStats: () => ({
            objects: 0,
            text: 0,
            graphics: 0,
            graphicsInstructions: [],
            graphicsDetails: [],
            textures: 0,
            canvasTextTextures: null,
          }),
          destroy: () => undefined,
        };
      },
    }));
    class MatchResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}

      public observe(target: Element): void {
        if (target.className.toString().includes('dock')) dockObserves += 1;
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: 150 });
        this.callback(
          [{ target, contentRect: { height: 0 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      public disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', MatchResizeObserver);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    render(<MatchPage />);
    await waitFor(() => expect(tap).toBeDefined());
    const dock = (): HTMLElement => {
      const element = document.querySelector<HTMLElement>('[class*="dock"]');
      if (!element) throw new Error('панель армий не найдена');
      return element;
    };
    const style = (): string[] => {
      const element = dock();
      return ['left', 'top', 'width', 'height'].map((property) =>
        element.style.getPropertyValue(property),
      );
    };
    const before = style();
    const observesBeforeSelection = dockObserves;
    const select = async (hex: number): Promise<void> => {
      const point = hexFromId(hex, mapResult.map.width);
      act(() => tap?.(point, 'select', { x: 0, y: 0 }));
      act(() => tap?.(point, 'select', { x: 0, y: 0 }));
      await waitFor(() => expect(document.querySelector('section[class*="card"]')).not.toBeNull());
    };

    await select(firstHex);
    expect(style()).toEqual(before);
    expect(dockObserves).toBe(observesBeforeSelection);
    const card = document.querySelector<HTMLElement>('section[class*="card"]');
    if (!card) throw new Error('карточка клетки не найдена');
    const expectedCard = computeMatchLayout({
      viewport: { width: 1440, height: 900 },
      hudHeight: 150,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: true,
      leaderboardOpen: true,
      leaderboardRows: 2,
      cardHeight: 150,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    }).elements.find((element) => element.id === 'card');
    if (!expectedCard) throw new Error('карточка не попала в раскладку');
    expect(
      ['left', 'top', 'width', 'height'].map((property) => card.style.getPropertyValue(property)),
    ).toEqual(
      [expectedCard.x, expectedCard.y, expectedCard.width, expectedCard.height].map(
        (value) => `${value}px`,
      ),
    );
    await select(secondHex);
    expect(style()).toEqual(before);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('section[class*="card"]')).toBeNull());
    expect(style()).toEqual(before);
  });

  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])('одновременно размещает панель и карточку в раскладке %dx%d', (width, height) => {
    const layout = computeMatchLayout({
      viewport: { width, height },
      hudHeight: 150,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 0,
      cardHeight: 150,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
    const dock = layout.elements.find((element) => element.id === 'bottom-panel');
    const card = layout.elements.find((element) => element.id === 'card');
    expect(dock).toBeDefined();
    expect(card).toBeDefined();
    expect(validateMatchLayout(layout)).toEqual([]);
    if (!dock || !card) return;
    expect(card.y + card.height).toBeLessThanOrEqual(dock.y - 8);
  });
});
