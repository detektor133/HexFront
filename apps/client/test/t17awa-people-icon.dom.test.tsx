import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: mapJson, map: loadedMap }),
    useSandbox: () => ({
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

describe('07/T17awa: иконка людей в HUD', () => {
  it('критерий: реальный путь MatchPage → MatchSurface → Hud содержит одну иконку людей', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const icons = screen.getAllByLabelText('Люди', { selector: 'svg' });
    expect(icons).toHaveLength(1);
  });

  it('критерий: иконка имеет viewBox «0 0 14 14», CSS-размер 14×14 и два завершённых силуэта', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');

    render(<MatchPage />);

    const icon = screen.getByLabelText('Люди', { selector: 'svg' });
    expect(icon.getAttribute('viewBox')).toBe('0 0 14 14');
    expect(hudCss).toMatch(
      /\.metricIcon\s*\{[\s\S]*?inline-size:\s*14px;[\s\S]*?block-size:\s*14px;/u,
    );

    const silhouettes = Array.from(icon.querySelectorAll('path'))
      .flatMap((path) => path.getAttribute('d')?.split(/(?=M)/u) ?? [])
      .filter((path) => /Z\s*$/iu.test(path));
    expect(silhouettes).toHaveLength(2);
  });

  it('критерий: геометрия двух силуэтов симметрична и все координаты находятся внутри viewBox', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const silhouettes = Array.from(
      screen.getByLabelText('Люди', { selector: 'svg' }).querySelectorAll('path'),
    )
      .flatMap((path) => path.getAttribute('d')?.split(/(?=M)/u) ?? [])
      .filter((path) => /Z\s*$/iu.test(path));
    const coordinates = silhouettes.flatMap((path) =>
      (path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number),
    );
    expect(coordinates.length).toBeGreaterThan(0);
    expect(coordinates.every((coordinate) => coordinate >= 0 && coordinate <= 14)).toBe(true);

    const bounds = silhouettes.map((path) => {
      const numbers = (path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
      const xCoordinates = numbers.filter((_, index) => index % 2 === 0);
      const yCoordinates = numbers.filter((_, index) => index % 2 === 1);
      return {
        minX: Math.min(...xCoordinates),
        maxX: Math.max(...xCoordinates),
        minY: Math.min(...yCoordinates),
        maxY: Math.max(...yCoordinates),
      };
    });
    const [left, right] = bounds;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect((left?.maxX ?? 0) + (right?.minX ?? 0)).toBe(14);
    expect((left?.minX ?? 0) + (right?.maxX ?? 0)).toBe(14);
    expect(left?.minY).toBe(right?.minY);
    expect(left?.maxY).toBe(right?.maxY);
  });
});
