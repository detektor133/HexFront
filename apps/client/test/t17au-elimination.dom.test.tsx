import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerView } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const engine = createLocalEngine(tinyMap, 42, 2);

if ('errors' in engine) throw new Error(engine.errors.join('; '));

const baseView = engine.snapshot().view;

function createView(overrides: Partial<PlayerView>): PlayerView {
  return { ...baseView, ...overrides };
}

function mockRuntime(
  view: PlayerView,
  setFog: ReturnType<typeof vi.fn>,
  send: ReturnType<typeof vi.fn>,
): void {
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMap, map: {} }),
    useSandbox: () => ({
      msg: { view, events: [] },
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
      send,
      setFog,
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

async function renderSurface(view: PlayerView): Promise<{
  readonly setFog: ReturnType<typeof vi.fn>;
  readonly navigate: ReturnType<typeof vi.fn>;
}> {
  const setFog = vi.fn();
  const send = vi.fn();
  const navigate = vi.fn();
  mockRuntime(view, setFog, send);
  vi.doMock('../src/match/pause-controller.ts', () => ({
    createPauseController: (options: {
      readonly navigate: (path: string) => void;
      readonly onStateChange: (paused: boolean, menuOpen: boolean) => void;
    }) => ({
      handleVisibilityChange: () => undefined,
      goToMenu: navigate,
      pause: () => options.onStateChange(true, true),
      restart: () => undefined,
      resume: () => options.onStateChange(false, false),
    }),
  }));
  const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
  render(<MatchSurface />);
  return { setFog, navigate };
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('DOM-приёмка выбывания из матча (07/T17au)', () => {
  it('критерий: выбывший локальный игрок видит место и кнопки «Наблюдать» и «В главное меню»', async () => {
    const view = createView({
      winner: -1,
      me: { ...baseView.me, place: 3 },
      players: baseView.players.map((player) =>
        player.id === baseView.playerId ? { ...player, status: 'eliminated' } : player,
      ),
    });

    await renderSurface(view);

    expect(screen.queryByRole('heading', { name: 'Вы выбыли · место 3' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Наблюдать' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'В главное меню' })).not.toBeNull();
  });

  it('критерий: «Наблюдать» отправляет { type: setFog, enabled: false }, скрывает экран и оставляет поверхность матча', async () => {
    const view = createView({
      winner: -1,
      players: baseView.players.map((player) =>
        player.id === baseView.playerId ? { ...player, status: 'eliminated' } : player,
      ),
    });

    const { setFog } = await renderSurface(view);
    const watchButton = screen.queryByRole('button', { name: 'Наблюдать' });
    expect(watchButton).not.toBeNull();
    if (!watchButton) return;
    fireEvent.click(watchButton);

    expect(setFog).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('heading', { name: /Вы выбыли/u })).toBeNull();
    expect(document.querySelector('[class*="map"]')).not.toBeNull();
  });

  it('критерий: «В главное меню» вызывает навигацию с `/`', async () => {
    const view = createView({
      winner: -1,
      players: baseView.players.map((player) =>
        player.id === baseView.playerId ? { ...player, status: 'eliminated' } : player,
      ),
    });
    const { navigate } = await renderSurface(view);

    const menuButton = screen.queryByRole('button', { name: 'В главное меню' });
    expect(menuButton).not.toBeNull();
    if (!menuButton) return;
    fireEvent.click(menuButton);

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('критерий: до выбывания экран отсутствует', async () => {
    await renderSurface(createView({ winner: -1 }));

    expect(screen.queryByRole('heading', { name: /Вы выбыли/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Наблюдать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'В главное меню' })).toBeNull();
  });

  it('критерий: экран победы сохраняется', async () => {
    await renderSurface(createView({ winner: baseView.playerId }));
    expect(screen.queryByRole('heading', { name: 'Победа' })).not.toBeNull();
  });

  it('критерий: экран ожидания удержания городов сохраняется', async () => {
    cleanup();
    vi.resetModules();

    await renderSurface(
      createView({ winner: -1, victoryHold: { player: baseView.playerId, seconds: 37 } }),
    );
    expect(screen.queryByText(/держит 70 % городов · 00:37/u)).not.toBeNull();
  });
});
