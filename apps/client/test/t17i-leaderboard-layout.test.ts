// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';

import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const viewports = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

function layoutFor(
  viewport: { readonly width: number; readonly height: number },
  overrides: Partial<Parameters<typeof computeMatchLayout>[0]> = {},
) {
  return computeMatchLayout({
    viewport,
    hudHeight: viewport.width <= 600 ? 44 : 48,
    bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
    eventRows: 0,
    tutorialVisible: false,
    leaderboardOpen: true,
    leaderboardRows: 5,
    cardHeight: 0,
    cardOpen: false,
    popupOpen: false,
    paused: false,
    ...overrides,
  });
}

function matchRuntime(): Record<string, unknown> {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  return {
    msg: engine.snapshot(),
    replay: [],
    error: null,
    picked: { hex: null, units: [], target: null },
    lastReject: null,
    tool: null,
    army: null,
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
    setHudHeight: () => undefined,
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
}

function installMatchRuntime(): void {
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: mapJson, map: {} }),
    useSandbox: () => matchRuntime(),
  }));
}

const OBSERVED_LEADERBOARD_SIZE = { width: 173, height: 139 } as const;

function installResizeObserver(): void {
  class ControlledResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      const size =
        target.getAttribute('aria-label') === 'Leaderboard'
          ? OBSERVED_LEADERBOARD_SIZE
          : { width: 0, height: 0 };
      this.callback(
        [
          {
            target,
            contentRect: new DOMRect(0, 0, size.width, size.height),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }

    public disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('07/T17i: раскладка лидерборда', () => {
  it('использует измеренную высоту пяти строк, а не число игроков', () => {
    for (const viewport of viewports) {
      const layout = layoutFor(viewport, { leaderboardRows: 30 });
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

      expect(leaderboard).toBeDefined();
      expect(leaderboard?.x).toBe(viewport.width - 16);
      expect(validateMatchLayout(layout)).toEqual([]);
    }

    const phone = computeMatchLayout({
      viewport: { width: 360, height: 640 },
      hudHeight: 44,
      bottomPanelHeight: 178,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 30,
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
    expect(phone.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      width: 344,
      height: 246,
    });
  });

  it('передаёт измеренный DOM-размер по пути MatchSurface → layout → Leaderboard', async () => {
    installMatchRuntime();
    installResizeObserver();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    for (const viewport of viewports.slice(0, 3)) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
      const { unmount } = render(createElement(MatchPage));
      await waitFor(() => {
        const leaderboard = document.querySelector<HTMLElement>('[class*="panel"]');
        expect(leaderboard?.style.left).toBe(
          `${viewport.width - 16 - OBSERVED_LEADERBOARD_SIZE.width}px`,
        );
        expect(leaderboard?.style.width).toBe('');
        expect(leaderboard?.style.height).toBe('');
      });
      expect(document.querySelector('[aria-label="Leaderboard"] h2')).not.toBeNull();
      unmount();
    }
  });

  it('сохраняет правую привязку и не зависит от числа игроков', () => {
    const layouts = viewports.slice(0, 3).map((viewport) =>
      layoutFor(viewport, {
        leaderboardRows: 30,
      }),
    );
    const leaderboards = layouts.map((layout) =>
      layout.elements.find((element) => element.id === 'leaderboard'),
    );

    expect(leaderboards.map((leaderboard) => leaderboard?.width)).toEqual([0, 0, 0]);
    expect(leaderboards.map((leaderboard) => leaderboard?.height)).toEqual([0, 0, 0]);
    expect(
      leaderboards.every((leaderboard, index) => {
        const viewport = viewports[index];
        return viewport !== undefined && leaderboard?.x === viewport.width - 16;
      }),
    ).toBe(true);
  });

  it('на телефоне сохраняет действующую полноширинную раскладку', () => {
    const layout = computeMatchLayout({
      viewport: { width: 360, height: 640 },
      hudHeight: 44,
      bottomPanelHeight: 178,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 5,
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });

    expect(layout.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      x: 8,
      width: 344,
      y: 52,
      height: 246,
    });
  });
  it('desktop-раскладка не получает фиксированные размеры без DOM-измерения', () => {
    const layout = layoutFor({ width: 1440, height: 900 });
    const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

    expect(leaderboard).toMatchObject({ x: 1424, width: 0, height: 0 });
    expect([150, 136, 138]).not.toContain(leaderboard?.width);
    expect([150, 136, 138]).not.toContain(leaderboard?.height);
  });
});
