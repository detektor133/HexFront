// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { afterEach, beforeEach, vi } from 'vitest';

import { installPanelStyles } from './panel-css.ts';
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

let leaderboardResizeEvent: { width: number; height: number } = { width: 173, height: 139 };
let taxAnchor: { x: number; y: number } | undefined;
let removeStyles: () => void;
beforeEach(() => {
  removeStyles = installPanelStyles();
});

function installResizeObserver(): void {
  class ControlledResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      if (
        target.tagName === 'BUTTON' &&
        /Налог|Tax/u.test(target.getAttribute('aria-label') ?? '')
      ) {
        // Якорь popup — управляемый вход; геометрия самой панели не подменяется.
        Object.defineProperty(target, 'getBoundingClientRect', {
          configurable: true,
          value: () =>
            new DOMRect(taxAnchor?.x ?? window.innerWidth - 200, taxAnchor?.y ?? 64, 44, 44),
        });
      }
      const size =
        target.getAttribute('aria-label') === 'Leaderboard'
          ? leaderboardResizeEvent
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
  removeStyles();
  leaderboardResizeEvent = { width: 173, height: 139 };
  taxAnchor = undefined;
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
      const leaderboard = document.querySelector<HTMLElement>('[class*="panel"]');
      await waitFor(() => {
        expect(leaderboard?.style.left).toBe(
          `${viewport.width - 16 - (leaderboardResizeEvent.width + 14)}px`,
        );
        expect(leaderboard?.style.width).toBe('');
        expect(leaderboard?.style.height).toBe('');
      });
      fireEvent.click(screen.getByRole('button', { name: /Tax/u }));
      await waitFor(() => expect(leaderboard?.style.top).toBe('236px'));
      expect(document.querySelector('[aria-label="Leaderboard"] h2')).not.toBeNull();
      unmount();

      leaderboardResizeEvent = { width: 173, height: 95 };
      const paddedLeaderboard = render(createElement(MatchPage));
      const paddedRegion = await screen.findByRole('region', { name: /Leaderboard/u });
      fireEvent.click(screen.getByRole('button', { name: /Tax/u }));
      // 95 px содержимого не пересекают popup на y=108; внешние 109 px пересекают.
      await waitFor(() => expect(paddedRegion.style.top).toBe('236px'));
      paddedLeaderboard.unmount();

      leaderboardResizeEvent = { width: 173, height: 1 };
      const shortLeaderboard = render(createElement(MatchPage));
      const shortRegion = await screen.findByRole('region', { name: /Leaderboard/u });
      fireEvent.click(screen.getByRole('button', { name: /Tax/u }));
      await waitFor(() => expect(shortRegion.style.top).toBe('8px'));
      shortLeaderboard.unmount();
      leaderboardResizeEvent = { width: 173, height: 139 };
    }

    taxAnchor = { x: 220, y: 20 };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 601 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const { unmount } = render(createElement(MatchPage));
    const leaderboard = await screen.findByRole('region', { name: /Таблица лидеров|Leaderboard/u });
    await waitFor(() => expect(leaderboard.style.top).toBe('8px'));

    fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));
    await waitFor(() => expect(leaderboard.style.top).toBe('192px'));

    const measuredLayout = layoutFor(
      { width: 601, height: 900 },
      {
        leaderboardSize: {
          width: leaderboardResizeEvent.width + 14,
          height: leaderboardResizeEvent.height + 14,
        },
        popupOpen: true,
        popupAnchorY: 64,
        popupSize: { width: 260, height: 120 },
      },
    );
    expect(measuredLayout.elements.find((element) => element.id === 'leaderboard')?.y).toBe(192);
    await waitFor(() => expect(leaderboard.style.top).toBe('192px'));
    unmount();

    leaderboardResizeEvent = { width: 173, height: 1 };
    const shortLeaderboard = render(createElement(MatchPage));
    const shortLeaderboardRegion = await screen.findByRole('region', {
      name: /Таблица лидеров|Leaderboard/u,
    });
    fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));
    await waitFor(() => expect(shortLeaderboardRegion.style.top).toBe('8px'));
    shortLeaderboard.unmount();
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
