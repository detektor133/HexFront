import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;

function installResizeObserver(): void {
  class TestResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      const height = target.className.toString().includes('dock') ? 150 : 88;
      this.callback(
        [{ target, contentRect: new DOMRect(0, 0, 1440, height) } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    public disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

function mockRuntime(selectedArmy: number | null = null): {
  send: ReturnType<typeof vi.fn>;
  setArmy: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const setArmy = vi.fn();
  const engine = createLocalEngine(tinyMap, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot();
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMap, map: loadedMap }),
    useSandbox: () => ({
      msg: snapshot,
      replay: [],
      error: null,
      picked: { hex: null, units: [], target: null },
      lastReject: null,
      tool: null,
      army: selectedArmy,
      fog: false,
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
      setFog: vi.fn(),
      setPaused: vi.fn(),
      step: vi.fn(),
      setSpeed: vi.fn(),
      setObserver: vi.fn(),
      pick: vi.fn(),
      setTool: vi.fn(),
      setArmy,
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
  return { send, setArmy };
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('DOM-приёмка панели армий (07/T17l)', () => {
  it('монтирует одну видимую панель и сохраняет выбор, резерв и команды', async () => {
    installResizeObserver();
    const { send, setArmy } = mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const dock = document.querySelector<HTMLElement>('[class*="dock"]');
    expect(dock).not.toBeNull();
    expect(Number.parseFloat(dock?.style.height ?? '0')).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '1-я армия' })).toHaveLength(2);

    const armyCard = screen.getAllByRole('button', { name: '1-я армия' })[0];
    if (!armyCard) throw new Error('Карточка армии не найдена');
    fireEvent.click(armyCard);
    expect(setArmy).toHaveBeenCalledWith(expect.any(Number));
    fireEvent.click(screen.getByRole('button', { name: 'Резерв' }));
    fireEvent.click(screen.getByRole('button', { name: 'Автопополнение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новая армия' }));
    expect(send).toHaveBeenNthCalledWith(1, { t: 'setAutoReinforce', on: true });
    expect(send).toHaveBeenNthCalledWith(2, { t: 'createArmy', name: '' });
  });

  it('оставляет тулбар выбранной армии и горизонтальную ленту карточек', async () => {
    installResizeObserver();
    mockRuntime(5);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    for (const label of [
      'Фронт',
      'Сначала назначьте фронт',
      'Оборона',
      'Нет линий, чтобы удалить',
      'Расформировать',
    ]) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
    expect(document.querySelector('[class*="strip"]')).not.toBeNull();
    expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
  });

  it('удерживает нижнюю панель внутри раскладки на телефоне и ПК', () => {
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: 88,
        bottomPanelHeight: 150,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 0,
        cardHeight: 300,
        cardOpen: true,
        popupOpen: false,
        paused: false,
      });
      expect(layout.elements.some((element) => element.id === 'bottom-panel')).toBe(true);
      expect(validateMatchLayout(layout)).toEqual([]);
    }
  });
});
