import { readFileSync } from 'node:fs';
import path from 'node:path';

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
const armyBarCss = readFileSync(
  path.resolve(process.cwd(), 'apps/client/src/dev/ArmyBar.module.css'),
  'utf8',
);

function installResizeObserver(): void {
  class TestResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
      const isDock = target.className.toString().includes('dock');
      Object.defineProperty(target, 'scrollHeight', {
        configurable: true,
        value: isDock ? 150 : 88,
      });
      this.callback(
        [{ target, contentRect: new DOMRect(0, 0, 1440, 0) } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    public disconnect(): void {}
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

function mockRuntime(
  selectedArmy: number | null = null,
  armyCount = 2,
): {
  send: ReturnType<typeof vi.fn>;
  setArmy: ReturnType<typeof vi.fn>;
  pick: ReturnType<typeof vi.fn>;
  setTool: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const setArmy = vi.fn();
  const pick = vi.fn();
  const setTool = vi.fn();
  const engine = createLocalEngine(tinyMap, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const initial = engine.snapshot();
  const sourceArmy = initial.view.armies[0];
  if (!sourceArmy) throw new Error('Исходная армия не найдена');
  const armies = Array.from({ length: armyCount }, (_, index) => ({
    ...sourceArmy,
    id: index === 0 ? (selectedArmy ?? sourceArmy.id) : (selectedArmy ?? sourceArmy.id) + index,
    number: index + 1,
    name: `${index + 1}-я армия`,
  }));
  const plans =
    selectedArmy === null
      ? initial.view.plans
      : [
          {
            armyId: selectedArmy,
            kind: 'front' as const,
            edges: [],
            hexes: [],
            offensive: null,
            zone: [],
            stuck: false,
            facing: [],
            lost: [],
            startWanted: false,
          },
        ];
  const snapshot = { ...initial, view: { ...initial.view, armies, plans } };
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
      pick,
      setTool,
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
  return { send, setArmy, pick, setTool };
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

    for (const label of ['Фронт', 'Наступление', 'Оборона', 'Удалить', 'Расформировать']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
    expect(document.querySelector('[class*="strip"]')).not.toBeNull();
    expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
  });

  it.each([1, 3, 10])('рендерит %d армий и резерв в реальном DOM', async (armyCount) => {
    installResizeObserver();
    mockRuntime(null, armyCount);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const strip = document.querySelector<HTMLElement>('[class*="strip"]');
    const content = document.querySelector<HTMLElement>('[class*="stripContent"]');
    if (!content) throw new Error('Содержимое ленты не найдено');
    const cards = [...content.children].filter((child) =>
      child.className.toString().includes('card'),
    );
    expect(cards).toHaveLength(armyCount);
    expect(screen.getByRole('button', { name: 'Резерв' })).toBeTruthy();
    expect(strip).not.toBeNull();
    expect(content).not.toBeNull();
    expect(content?.children).toHaveLength(armyCount + 1);
    const stripCss =
      [...armyBarCss.matchAll(/\.strip\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((block) => block.includes('align-self')) ?? '';
    expect(stripCss).toMatch(/overflow-x:\s*auto/);
    expect(stripCss).toMatch(/pointer-events:\s*none/);
    expect(stripCss).not.toMatch(/overflow-y:\s*(auto|scroll)/);
    for (const card of cards) {
      expect(card.className.toString()).toContain('card');
    }
    expect(armyBarCss).toMatch(/\.card\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(armyBarCss).toMatch(/\.card\s*\{[^}]*flex:\s*0\s+0\s+238px/s);
  });

  it('докручивает переполненную ленту до последней карточки колесом и не блокирует карту', async () => {
    installResizeObserver();
    const { pick, setArmy } = mockRuntime(null, 10);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const strip = document.querySelector<HTMLElement>('[class*="strip"]');
    const content = document.querySelector<HTMLElement>('[class*="stripContent"]');
    if (!strip || !content) throw new Error('Лента армий не найдена');
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 238 });
    Object.defineProperty(strip, 'scrollWidth', {
      configurable: true,
      value: 10 * 238 + content.children.length * 8,
    });
    Object.defineProperty(strip, 'scrollLeft', { configurable: true, writable: true, value: 0 });
    const wheel = new WheelEvent('wheel', { bubbles: true, deltaX: 238, deltaY: 0 });
    strip.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    const cards = [...content.children].filter((child) =>
      child.className.toString().includes('card'),
    );
    expect(cards[9]).toBeTruthy();
    fireEvent.click(cards[9]?.querySelector('[class*="pick"]') as HTMLElement);
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    expect(fireEvent.click(strip)).toBe(true);
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ hex: null }));
    expect(setArmy).toHaveBeenCalledWith(expect.any(Number));
    expect(armyBarCss).toMatch(/\.strip\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('передаёт клики по карточке, резерву, приказам, автопополнению и созданию армии', async () => {
    installResizeObserver();
    const { send, setArmy, setTool, pick } = mockRuntime(5);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    fireEvent.click(
      document.querySelectorAll('[class*="strip"] [class*="pick"]')[1] as HTMLElement,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Резерв' }));
    fireEvent.click(screen.getByRole('button', { name: 'Автопополнение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новая армия' }));
    fireEvent.click(screen.getByRole('button', { name: 'Фронт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Наступление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Оборона' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Расформировать' }));

    expect(setArmy).toHaveBeenCalledWith(expect.any(Number));
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ hex: null }));
    expect(setTool).toHaveBeenCalledWith({ tool: 'front', armyId: expect.any(Number) });
    expect(setTool).toHaveBeenCalledWith({ tool: 'offensive', armyId: expect.any(Number) });
    expect(setTool).toHaveBeenCalledWith({ tool: 'line', armyId: expect.any(Number) });
    expect(setTool).toHaveBeenCalledWith({ tool: 'erase', armyId: expect.any(Number) });
    expect(send).toHaveBeenCalledWith({ t: 'setAutoReinforce', on: true });
    expect(send).toHaveBeenCalledWith({ t: 'createArmy', name: '' });
    expect(send).toHaveBeenCalledWith({ t: 'disbandArmy', armyId: expect.any(Number) });
  });

  it('сохраняет реальный DOM всех интерактивных элементов в растянутой ленте', async () => {
    installResizeObserver();
    mockRuntime(5);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);

    const strip = document.querySelector<HTMLElement>('[class*="strip"]');
    const content = document.querySelector<HTMLElement>('[class*="stripContent"]');
    expect(strip).not.toBeNull();
    expect(content).not.toBeNull();
    expect(content?.parentElement).toBe(strip);
    expect(screen.getByRole('button', { name: 'Резерв' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Автопополнение' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Новая армия' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0);
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
