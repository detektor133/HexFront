// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout } from '../src/match/layout.ts';

const MAP_JSON: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(MAP_JSON);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;

let sentCommands: unknown[] = [];

function createRuntime(): Record<string, unknown> {
  sentCommands = [];
  const engine = createLocalEngine(MAP_JSON, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot();
  return {
    msg: snapshot,
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
    send: (command: unknown) => {
      sentCommands.push(command);
    },
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

function mockRuntime(): void {
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: MAP_JSON, map: loadedMap }),
    useSandbox: () => createRuntime(),
  }));
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function readInlineRect(element: HTMLElement): Rect {
  return {
    x: Number.parseFloat(element.style.left),
    y: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  };
}

function overlaps(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('07/T17j: налог не скрывает лидерборд', () => {
  it('сохраняет раскрытие лидерборда при открытии, изменении и закрытии налога', async () => {
    mockRuntime();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const leaderboard = screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u });
    const taxButton = screen.getByRole('button', { name: /Налог|Tax/u });
    const initialRect = readInlineRect(leaderboard);

    expect(leaderboard).toBeTruthy();
    fireEvent.click(taxButton);
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBe(leaderboard);
    expect(readInlineRect(leaderboard)).toEqual(initialRect);
    const slider = screen.getByRole('slider', { name: /Налог|Tax/u });
    fireEvent.change(screen.getByRole('slider', { name: /Налог|Tax/u }), {
      target: { value: '300' },
    });
    expect(sentCommands).toContainEqual({ t: 'setTax', rate: 300 });
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBe(leaderboard);
    expect(readInlineRect(leaderboard)).toEqual(initialRect);
    fireEvent.click(taxButton);
    expect(screen.queryByRole('dialog', { name: /Налог|Tax/u })).toBeNull();
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBe(leaderboard);
    expect(readInlineRect(leaderboard)).toEqual(initialRect);
    expect(slider).toBeTruthy();
  });

  it('сохраняет кнопку свёрнутого лидерборда при открытом налоге', async () => {
    mockRuntime();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const taxButton = screen.getByRole('button', { name: /Налог|Tax/u });
    const leaderboardButton = screen.getByRole('button', {
      name: /Таблица лидеров|Leaderboard/u,
    });

    fireEvent.click(taxButton);
    expect(screen.getByRole('button', { name: /Таблица лидеров|Leaderboard/u })).toBe(
      leaderboardButton,
    );
    fireEvent.change(screen.getByRole('slider', { name: /Налог|Tax/u }), {
      target: { value: '300' },
    });
    expect(sentCommands).toContainEqual({ t: 'setTax', rate: 300 });
    expect(screen.getByRole('button', { name: /Таблица лидеров|Leaderboard/u })).toBe(
      leaderboardButton,
    );
    fireEvent.click(taxButton);
    expect(screen.getByRole('button', { name: /Таблица лидеров|Leaderboard/u })).toBe(
      leaderboardButton,
    );
  });

  it('оставляет лидерборд в раскладке при открытом налоге и разводит прямоугольники', () => {
    const viewports = [
      { width: 360, height: 640, hudHeight: 44, anchorX: 80, anchorY: 44 },
      { width: 1440, height: 900, hudHeight: 48, anchorX: 320, anchorY: 48 },
    ] as const;

    for (const viewport of viewports) {
      // Кнопка налога — реальный якорь попапа; проверяем обе кнопки задачи
      // («не пересекается ... с кнопками»): кнопку налога и кнопку лидерборда.
      const taxButtonRect: Rect = {
        x: viewport.anchorX,
        y: 0,
        width: 120,
        height: viewport.hudHeight,
      };

      const baseline = computeMatchLayout({
        viewport,
        hudHeight: viewport.hudHeight,
        bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 5,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        popupAnchorX: viewport.anchorX,
        popupAnchorY: viewport.anchorY,
        popupSize: { width: 260, height: 120 },
        paused: false,
      }).elements.find((element) => element.id === 'leaderboard');
      expect(baseline).toBeDefined();

      for (const leaderboardOpen of [true, false] as const) {
        const layout = computeMatchLayout({
          viewport,
          hudHeight: viewport.hudHeight,
          bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
          eventRows: 0,
          tutorialVisible: false,
          leaderboardOpen,
          leaderboardRows: 5,
          cardHeight: 0,
          cardOpen: false,
          popupOpen: true,
          popupAnchorX: viewport.anchorX,
          popupAnchorY: viewport.anchorY,
          popupSize: { width: 260, height: 120 },
          paused: false,
        });
        const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');
        const popup = layout.elements.find((element) => element.id === 'popup-menu');
        expect(leaderboard).toBeDefined();
        expect(popup).toBeDefined();
        if (!leaderboard || !popup) continue;

        if (leaderboardOpen) {
          expect(leaderboard.width).toBe(baseline?.width);
          expect(leaderboard.height).toBe(baseline?.height);
          if (viewport.width > 600) {
            expect(leaderboard.x).toBe(baseline?.x);
            expect(leaderboard.y).toBe(baseline?.y);
          } else {
            expect(leaderboard.x).toBe(baseline?.x);
            expect(leaderboard.y).toBeGreaterThanOrEqual(baseline?.y ?? 0);
          }
        }

        expect(leaderboard.x).toBeGreaterThanOrEqual(0);
        expect(leaderboard.y).toBeGreaterThanOrEqual(0);
        expect(leaderboard.x + leaderboard.width).toBeLessThanOrEqual(viewport.width);
        expect(leaderboard.y + leaderboard.height).toBeLessThanOrEqual(viewport.height);

        if (leaderboardOpen) {
          const defaultLeaderboard = layout.elements.find(
            (element) => element.id === 'leaderboard',
          );
          if (!defaultLeaderboard) continue;
          if (overlaps(defaultLeaderboard, popup)) {
            expect(leaderboard.y).toBeGreaterThanOrEqual(popup.y + popup.height + 8);
          }
        } else {
          // Свёрнутый лидерборд — сам и есть кнопка лидерборда: проверяем,
          // что окно налога не закрывает её, когда лидерборд остаётся доступной кнопкой.
          expect(overlaps(leaderboard, popup)).toBe(false);
        }

        expect(overlaps(leaderboard, taxButtonRect)).toBe(false);
        expect(overlaps(popup, taxButtonRect)).toBe(false);
        expect(overlaps(leaderboard, popup)).toBe(false);
      }
    }
  });

  it('сохраняет поведение нижней панели T17e при открытом налоге', () => {
    const layout = computeMatchLayout({
      viewport: { width: 1440, height: 900 },
      hudHeight: 48,
      bottomPanelHeight: 132,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 5,
      cardHeight: 0,
      cardOpen: false,
      popupOpen: true,
      popupAnchorX: 320,
      popupAnchorY: 48,
      popupSize: { width: 260, height: 120 },
      paused: false,
    });

    expect(layout.elements.some((element) => element.id === 'bottom-panel')).toBe(false);
    expect(layout.mapVisibleHeight).toBe(900 - 48);
  });
});
