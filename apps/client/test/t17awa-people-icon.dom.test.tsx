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
const hudSource = readFileSync('apps/client/src/dev/Hud.tsx', 'utf8');

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

  it('Заменён тест: готовая Tabler иконка людей имеет размер 14×14 px', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);

    const icon = screen.getByLabelText('Люди', { selector: 'svg' });
    expect(icon.getAttribute('width')).toBe('14');
    expect(icon.getAttribute('height')).toBe('14');
    expect(hudSource).toContain('people: IconUsers');
  });

  it('сохраняет доступное имя и привязку к числу населения', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const icon = screen.getByLabelText('Люди', { selector: 'svg' });
    expect(icon.querySelector('title')?.textContent).toBe('Люди');
    const slot = icon.parentElement;
    if (!slot) throw new Error('Иконка людей не связана со значением');
    expect(slot.textContent).toContain('280');
    expect(slot.textContent).toContain('+2,8/с');
  });
});
