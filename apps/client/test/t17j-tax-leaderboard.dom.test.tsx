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

function createRuntime(): Record<string, unknown> {
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

function mockRuntime(): void {
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: MAP_JSON, map: loaded.map }),
    useSandbox: () => createRuntime(),
  }));
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

    expect(leaderboard).toBeTruthy();
    fireEvent.click(taxButton);
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBeTruthy();
    fireEvent.change(screen.getByRole('slider', { name: /Налог|Tax/u }), {
      target: { value: '300' },
    });
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBeTruthy();
    fireEvent.click(taxButton);
    expect(screen.getByRole('region', { name: /Таблица лидеров|Leaderboard/u })).toBeTruthy();
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
  });

  it('оставляет лидерборд в раскладке при открытом налоге и разводит прямоугольники', () => {
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
      popupOpen: true,
      popupAnchorX: 80,
      popupAnchorY: 44,
      popupSize: { width: 260, height: 120 },
      paused: false,
    });
    const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');
    const popup = layout.elements.find((element) => element.id === 'popup-menu');
    expect(leaderboard).toBeDefined();
    expect(popup).toBeDefined();
    if (!leaderboard || !popup) return;
    expect(leaderboard.y).toBeGreaterThanOrEqual(popup.y + popup.height + 8);
    expect(leaderboard.y + leaderboard.height).toBeLessThanOrEqual(640);
  });
});
