import { readFileSync } from 'node:fs';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);

const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

const engine = createLocalEngine(tinyMap, 42, 2);
if ('errors' in engine) throw new Error(engine.errors.join('; '));

const view: PlayerView = engine.snapshot().view;
const sandbox = {
  msg: { ...engine.snapshot(), view },
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
};

function setWindow(search: string, pathname = '/match'): void {
  Object.assign(globalThis, {
    window: {
      location: { search, pathname },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('экран матча игрока', () => {
  it('/match без debug рендерит экран игрока без панели наблюдателя, тумана и отказа команды', async () => {
    vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
      useMapJson: () => ({ json: tinyMap, map: loaded.map }),
      useSandbox: () => sandbox,
    }));
    setWindow('');

    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(
      createElement(MatchSurface, { debug: false, showOnboarding: true }),
    );

    expect(markup).not.toContain('aria-label="Наблюдатель"');
    expect(markup).not.toContain('Вся карта');
    expect(markup).not.toContain('Скачать телеметрию');
    expect(markup).not.toContain('Последний отказ');
  });

  it('/match?debug=1 рендерит реальную панель наблюдателя', async () => {
    vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
      useMapJson: () => ({ json: tinyMap, map: loaded.map }),
      useSandbox: () => sandbox,
    }));
    setWindow('?debug=1');

    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(
      createElement(MatchSurface, { debug: true, showOnboarding: true }),
    );

    expect(markup).toContain('aria-label="Наблюдатель"');
    expect(markup).toContain('Пауза');
    expect(markup).toContain('Шаг');
    expect(markup).toContain('1×');
    expect(markup).toContain('5×');
    expect(markup).toContain('20×');
    expect(markup).toContain('Вся карта');
    expect(markup).toContain('Скачать телеметрию');
  });

  it('в production маршрут /dev/sandbox возвращает «Страница не найдена»', async () => {
    const render = vi.fn();
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render }),
    }));
    vi.stubEnv('PROD', true);
    setWindow('', '/dev/sandbox');
    Object.assign(globalThis, {
      document: { getElementById: vi.fn(() => ({})) },
    });

    await import('../src/main.tsx');
    const strictMode = render.mock.calls[0]?.[0] as ReactElement<{ children: ReactElement }>;
    const appElement = strictMode.props.children as ReactElement;
    const routeElement = (appElement.type as () => ReactElement)();

    expect(renderToStaticMarkup(routeElement)).toContain('Страница не найдена');
  });
});
