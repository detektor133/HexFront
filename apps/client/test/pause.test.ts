import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);

const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

const engine = createLocalEngine(tinyMap, 42, 2);
if ('errors' in engine) throw new Error(engine.errors.join('; '));

function setWindow(search: string): void {
  Object.assign(globalThis, {
    window: {
      location: { search, pathname: '/match' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('пауза локального матча', () => {
  it('кнопка паузы останавливает тики воркера и открывает меню', async () => {
    const { createPauseController } = await import('../src/match/pause-controller.ts');
    const worker = { postMessage: vi.fn() };
    const controller = createPauseController({
      worker,
      seed: 42,
      navigate: vi.fn(),
      restart: vi.fn(),
    });

    controller.pause();

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'pause' });
    expect(controller.isPaused()).toBe(true);
    expect(controller.isMenuOpen()).toBe(true);
  });

  it('«Продолжить» снимает паузу', async () => {
    const { createPauseController } = await import('../src/match/pause-controller.ts');
    const worker = { postMessage: vi.fn() };
    const controller = createPauseController({
      worker,
      seed: 42,
      navigate: vi.fn(),
      restart: vi.fn(),
    });

    controller.pause();
    controller.resume();

    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'resume' });
    expect(controller.isPaused()).toBe(false);
    expect(controller.isMenuOpen()).toBe(false);
  });

  it('«Заново» перезапускает матч с тем же сидом', async () => {
    const { createPauseController } = await import('../src/match/pause-controller.ts');
    const restart = vi.fn();
    const controller = createPauseController({
      worker: { postMessage: vi.fn() },
      seed: 42,
      navigate: vi.fn(),
      restart,
    });

    controller.restart();

    expect(restart).toHaveBeenCalledWith(42);
  });

  it('«В меню» ведёт на «/»', async () => {
    const { createPauseController } = await import('../src/match/pause-controller.ts');
    const navigate = vi.fn();
    const controller = createPauseController({
      worker: { postMessage: vi.fn() },
      seed: 42,
      navigate,
      restart: vi.fn(),
    });

    controller.goToMenu();

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('visibilitychange со «hidden» ставит матч на паузу с открытым меню', async () => {
    const { createPauseController } = await import('../src/match/pause-controller.ts');
    const worker = { postMessage: vi.fn() };
    const controller = createPauseController({
      worker,
      seed: 42,
      navigate: vi.fn(),
      restart: vi.fn(),
    });

    controller.handleVisibilityChange(true);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'pause' });
    expect(controller.isPaused()).toBe(true);
    expect(controller.isMenuOpen()).toBe(true);
  });

  it('/match без debug не показывает выбор скорости', async () => {
    vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
      useMapJson: () => ({ json: tinyMap, map: loaded.map }),
      useSandbox: () => ({
        msg: { ...engine.snapshot(), view: engine.snapshot().view },
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
    setWindow('');

    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(createElement(MatchSurface));

    expect(markup).not.toContain('1×');
    expect(markup).not.toContain('5×');
    expect(markup).not.toContain('20×');
  });
});
