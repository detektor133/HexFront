import { readFileSync } from 'node:fs';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;

function mockRuntime(): void {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot();
  const source = snapshot.view;
  const view = {
    ...source,
    me: {
      ...source.me,
      popTotal: 987_654_000,
      popGrowthPerS: 12_345_000,
      incomePerS: 0,
      upkeepPerS: 2_100_000,
    },
    players: source.players.map((player) => ({ ...player, gold: 1_234_567_000 })),
  };
  const player = view.players[view.playerId];
  if (!player) throw new Error('Локальный игрок не найден');

  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: mapJson, map: loadedMap }),
    useSandbox: () => ({
      msg: { ...snapshot, view },
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
      cacheTelemetry: () => ({
        unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
        economy: { capturesByHex: 0, cityFlashes: 0 },
        frontTween: { byArmy: 0 },
      }),
      snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
      focusEvent: vi.fn(),
      send: vi.fn(),
      setFog: vi.fn(),
      setPaused: vi.fn(),
      step: vi.fn(),
      setSpeed: vi.fn(),
      setObserver: vi.fn(),
      pick: vi.fn(),
      setTool: vi.fn(),
      setArmy: vi.fn(),
      setRoadPreview: vi.fn(),
      setDockHeight: vi.fn(),
      setHudHeight: vi.fn(),
      pixiTelemetry: () => ({
        objects: 0,
        text: 0,
        graphics: 0,
        graphicsInstructions: [],
        graphicsDetails: [],
        textures: 0,
        canvasTextTextures: null,
      }),
    }),
  }));
}

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe('07/T17awb: значения HUD через полный DOM-путь', () => {
  it('проверяет компактные и полные значения людей, золота и обоих приростов', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    expect(screen.getByTitle('987 654')).toBeTruthy();
    expect(screen.getByTitle('1 234 567')).toBeTruthy();
    expect(screen.getByTitle('+12 345/с')).toBeTruthy();
    expect(screen.getByTitle('−2 100/с')).toBeTruthy();
    expect(screen.getByLabelText(/987 654/u)).toBeTruthy();
    expect(screen.getByLabelText(/1 234 567/u)).toBeTruthy();
    expect(screen.getByLabelText(/12 345/)).toBeTruthy();
    expect(screen.getByLabelText(/2 100/)).toBeTruthy();
    expect(screen.getByText('987к')).toBeTruthy();
    expect(screen.getByText('1,2м')).toBeTruthy();
    expect(screen.getByText('+12к/с')).toBeTruthy();
    expect(screen.getByText('−2,1к/с')).toBeTruthy();
  });
});
