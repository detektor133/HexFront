import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;
const engine = createLocalEngine(tinyMap, 42, 2);
if ('errors' in engine) throw new Error(engine.errors.join('; '));
const localEngine = engine;

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function mockRuntime(): void {
  const snapshot = localEngine.snapshot();
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMap, map: loadedMap }),
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
      snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
      cacheTelemetry: () => ({
        unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
        economy: { capturesByHex: 0, cityFlashes: 0 },
        frontTween: { byArmy: 0 },
      }),
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
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('DOM-приёмка экрана матча (07/T21)', () => {
  it('критерий: ADR фиксирует jsdom и Testing Library вместо happy-dom', () => {
    const adr = readProjectFile('docs/architecture/adr/0013-client-dom-test-environment.md');

    expect(adr).toContain('jsdom');
    expect(adr).toContain('@testing-library/react');
    expect(adr).toContain('happy-dom');
  });

  it('критерий: тесты с суффиксом .dom.test.tsx получают среду jsdom', () => {
    const projects = readProjectFile('vitest.projects.ts');
    const packageJson = JSON.parse(readProjectFile('apps/client/package.json')) as {
      devDependencies?: Record<string, string>;
    };

    expect(projects).toContain('.dom.test.tsx');
    expect(projects).toContain('jsdom');
    expect(packageJson.devDependencies?.jsdom).toBeDefined();
    expect(packageJson.devDependencies?.['@testing-library/react']).toBeDefined();
  });

  it('критерий: клик по кнопке паузы открывает меню паузы, «Продолжить» его закрывает', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
