import { readFileSync } from 'node:fs';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const MAP_JSON: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const LOADED_MAP = loadMap(MAP_JSON);
if (!LOADED_MAP.ok) throw new Error(LOADED_MAP.errors.join('; '));

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

function createRuntime(search: string): Record<string, unknown> {
  const engine = createLocalEngine(MAP_JSON, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));

  const selectedHex = search === '?hex=0' ? 0 : null;
  engine.select(selectedHex);
  const snapshot = engine.snapshot();
  const selectedArmy = snapshot.view.units.find((unit) => unit.armyId !== null)?.armyId ?? null;
  const armySelected = search === '?army=1';

  return {
    msg: snapshot,
    replay: [],
    error: null,
    picked: {
      hex: selectedHex,
      units: armySelected
        ? snapshot.view.units.filter((unit) => unit.armyId === selectedArmy).map((unit) => unit.id)
        : [],
      target: null,
    },
    lastReject: null,
    tool: null,
    army: armySelected ? selectedArmy : null,
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

async function renderMatch(search: string): Promise<void> {
  window.history.replaceState({}, '', `/match${search}`);
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: MAP_JSON, map: LOADED_MAP.map }),
    useSandbox: () => createRuntime(search),
  }));
  const { MatchPage } = await import('../src/match/MatchPage.tsx');
  render(<MatchPage />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('приёмка 07/T17c: панели матча в левом нижнем углу', () => {
  it('критерий 1: раскладка панелей не выходит за экран и не пересекается на 360×640, 1440×900 и 1920×1080', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: viewport.width <= 600 ? 88 : 48,
        bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 2,
        cardHeight: 303,
        cardOpen: true,
        popupOpen: false,
        paused: false,
      });
      const ids = new Set(layout.elements.map((element) => element.id));

      expect([...ids]).toEqual(expect.arrayContaining(['bottom-panel', 'card']));
      expect(validateMatchLayout(layout)).toEqual([]);
    }
  });

  it('критерий 2: панель армий рендерится при выборе армии, а окно клетки — при выборе клетки', async () => {
    await renderMatch('?army=1');
    const armyPanel = document.querySelector<HTMLElement>('[class*="dock"]');
    expect(armyPanel).not.toBeNull();
    expect(armyPanel?.textContent).toMatch(/армия|army/iu);

    cleanup();
    vi.resetModules();
    await renderMatch('?hex=0');
    const cellCard = document.querySelector<HTMLElement>('section[class*="card"]');
    expect(cellCard).not.toBeNull();
    expect(cellCard?.textContent?.trim()).not.toBe('');
  });
});
