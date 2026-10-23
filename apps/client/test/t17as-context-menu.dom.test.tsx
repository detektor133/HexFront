// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type Command } from '@hexfront/sim';

import { cityChipShift } from '../src/dev/chip-place.ts';
import { messages } from '../src/i18n/dict.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { MatchSurface } from '../src/match/MatchSurface.tsx';
import { RADIAL_MENU_LONG_PRESS_MS } from '../src/render/gesture.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<Record<string, unknown>>();
  const PixiContainer = pixi.Container as typeof Container;
  class TestApplication {
    readonly canvas = document.createElement('canvas');
    readonly stage = new PixiContainer();
    readonly ticker = {
      callbacks: [] as Array<(ticker: { deltaMS: number; FPS: number }) => void>,
      add: (callback: (ticker: { deltaMS: number; FPS: number }) => void): void => {
        this.ticker.callbacks.push(callback);
      },
    };
    readonly renderer = { texture: { managedTextures: [] as readonly unknown[] } };
    screen = { width: 390, height: 844 };

    constructor() {
      (globalThis as Record<string, unknown>).__t17asApp = this;
      Object.defineProperty(this.canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0 }),
      });
      Object.defineProperty(this.canvas, 'setPointerCapture', { value: vi.fn() });
    }

    async init(options: {
      readonly resizeTo: { clientWidth?: number; clientHeight?: number };
    }): Promise<void> {
      this.screen = {
        width: options.resizeTo.clientWidth || 390,
        height: options.resizeTo.clientHeight || 844,
      };
    }

    destroy(): void {}
  }
  return { ...pixi, Application: TestApplication };
});

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const testMap = loaded.map;

const harness = vi.hoisted(() => ({
  commands: [] as Command[],
  fixture: 'stack' as 'stack' | 'artillery',
  canvas: null as HTMLCanvasElement | null,
  app: null as {
    canvas: HTMLCanvasElement;
    stage: Container;
    ticker: { callbacks: Array<(ticker: { deltaMS: number; FPS: number }) => void> };
  } | null,
  unitHex: 0,
  unitCityLevel: null as number | null,
  selectedUnitIds: [] as number[],
  availableArmyIds: [] as number[],
}));

class TestWorker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

  public postMessage(message: { t: string; map?: unknown; seed?: number; players?: number }): void {
    if ('cmd' in message) {
      harness.commands.push((message as { cmd: Command }).cmd);
      return;
    }
    if (message.t !== 'start') return;
    const engine = createLocalEngine(message.map, message.seed ?? 42, message.players ?? 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const snapshot = engine.snapshot();
    const ownUnits = snapshot.view.units.filter((unit) => unit.owner === snapshot.view.playerId);
    const firstUnit = ownUnits[0];
    if (!firstUnit) throw new Error('В фикстуре нет собственного отряда');
    let view = snapshot.view;
    if (harness.fixture === 'stack') {
      const secondUnit = ownUnits.find((unit) => unit.id !== firstUnit.id);
      if (!secondUnit) throw new Error('В фикстуре нет пары собственных отрядов');
      const preparedUnits = snapshot.view.units.map((unit) => {
        if (unit.id === firstUnit.id || unit.id === secondUnit.id) {
          return {
            ...unit,
            armyId: null,
            hex: firstUnit.hex,
            type: 'infantry' as const,
            order: 'idle' as const,
            moveTotal: 0,
          };
        }
        return unit;
      });
      view = { ...snapshot.view, units: preparedUnits };
    } else {
      const artillery = { ...firstUnit, armyId: null, type: 'artillery' as const };
      view = { ...snapshot.view, units: [artillery] };
    }
    harness.unitHex = view.units[0]?.hex ?? 0;
    harness.unitCityLevel = view.cities.find((city) => city.hex === harness.unitHex)?.level ?? null;
    harness.selectedUnitIds = view.units
      .filter((unit) => unit.owner === view.playerId && unit.hex === harness.unitHex)
      .map((unit) => unit.id);
    harness.availableArmyIds = view.armies.map((army) => army.id);
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          t: 'view',
          kind: 'snapshot',
          snapshot: { t: 'snapshot', tick: view.tick, view },
          seq: 1,
          selection: snapshot.selection,
          rejected: snapshot.rejected,
          events: snapshot.events,
        },
      } as MessageEvent),
    );
  }

  public terminate(): void {}
}

function armyCard(): HTMLElement {
  const card = screen.getAllByRole('button').find((item) => item.className.includes('_pick_'));
  if (!card) throw new Error('Карточка армии не отрендерена');
  return card;
}

async function renderSurface(fixture: 'stack' | 'artillery' = 'stack'): Promise<void> {
  harness.fixture = fixture;
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(mapJson), { status: 200 })),
  );
  render(createElement(MatchSurface, { debug: true }));
  await waitFor(() => expect(armyCard()).toBeTruthy());
  fireEvent.click(armyCard());
  await waitFor(() =>
    expect(
      screen.getAllByRole('button').some((item) => item.getAttribute('aria-pressed') === 'true'),
    ).toBe(true),
  );
  const app = (globalThis as Record<string, unknown>).__t17asApp as typeof harness.app;
  if (!app) throw new Error('Pixi Application не создан');
  app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
  harness.app = app;
  harness.canvas = app.canvas;
}

function unitPoint(): { x: number; y: number } {
  if (!harness.app) throw new Error('MapView не создан');
  const world = harness.app.stage.children[0];
  if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
  const point = hexCenter(hexFromId(harness.unitHex, testMap.width), tokens.map.hexRadius);
  return {
    x: world.position.x + point.x * world.scale.x,
    y:
      world.position.y +
      (point.y +
        (harness.unitCityLevel === null
          ? 0
          : cityChipShift(harness.unitCityLevel, tokens.map.hexRadius))) *
        world.scale.y,
  };
}

async function openMapMenu(
  fixture: 'stack' | 'artillery' = 'stack',
): Promise<{ menu: HTMLElement; point: { x: number; y: number } }> {
  await renderSurface(fixture);
  if (!harness.canvas) throw new Error('MapView input не подключён');
  const point = unitPoint();
  fireEvent.pointerDown(harness.canvas, {
    button: 0,
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
  });
  await new Promise((resolve) => setTimeout(resolve, RADIAL_MENU_LONG_PRESS_MS + 10));
  harness.app?.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
  return { menu: await screen.findByRole('menu'), point };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  harness.commands.length = 0;
  harness.fixture = 'stack';
  harness.canvas = null;
  harness.app = null;
  harness.unitCityLevel = null;
  harness.selectedUnitIds = [];
  harness.availableArmyIds = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('07/T17as: контекстное меню фишки отряда', () => {
  it('1: удержание фишки открывает одно меню в точке нажатия с доступными кнопками', async () => {
    const { menu, point } = await openMapMenu();
    await new Promise((resolve) => setTimeout(resolve, RADIAL_MENU_LONG_PRESS_MS + 10));
    expect(menu.isConnected).toBe(true);
    expect(Number.parseFloat(menu.style.left)).toBe(point.x);
    expect(Number.parseFloat(menu.style.top)).toBe(point.y);
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(0);
    const labels = items.map((item) => item.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining([messages.ru['unit.merge'], messages.ru['unit.toArmy']]),
    );
    expect(labels.every((label) => label !== null && !Object.hasOwn(messages.ru, label))).toBe(
      true,
    );
    expect(items.every((item) => item.style.pointerEvents === 'auto')).toBe(true);
  });

  it('1: каждая кнопка меню выполняет свою команду через send', async () => {
    const { menu } = await openMapMenu();
    const rootLabels = screen
      .getAllByRole('menuitem')
      .map((item) => item.getAttribute('aria-label'))
      .filter((label): label is string => label !== null);

    const expectCommand = (before: number): void => {
      expect(harness.commands.length).toBeGreaterThan(before);
      const command = harness.commands.at(-1);
      expect(command).toBeDefined();
      if (command?.t === 'split') {
        expect(command.unitId).toBeTypeOf('number');
        expect(harness.selectedUnitIds).toContain(command.unitId);
        expect(command.soldiers).toBeGreaterThan(0);
      } else if (command?.t === 'merge') {
        expect(command.unitIds).toEqual(harness.selectedUnitIds);
      } else if (command?.t === 'assignUnits') {
        expect(command.unitIds).toEqual(harness.selectedUnitIds);
        expect(command).toHaveProperty('armyId');
        if (command.armyId !== null) expect(harness.availableArmyIds).toContain(command.armyId);
      } else if (command?.t === 'bombard') {
        expect(command.unitId).toBeTypeOf('number');
        expect(harness.selectedUnitIds).toContain(command.unitId);
        expect(command.targetUnitId).toBeNull();
      } else {
        throw new Error(`Неожиданный тип команды: ${command?.t ?? 'нет команды'}`);
      }
    };

    for (const rootLabel of rootLabels) {
      cleanup();
      await openMapMenu();
      const root = screen
        .getAllByRole('menuitem')
        .find((item) => item.getAttribute('aria-label') === rootLabel);
      expect(root).toBeDefined();
      if (!root) throw new Error(`Корневая кнопка меню не найдена: ${rootLabel}`);
      const before = harness.commands.length;
      fireEvent.keyDown(root, { key: 'Enter' });

      if (screen.queryByRole('menu')) {
        const childLabels = screen
          .getAllByRole('menuitem')
          .map((item) => item.getAttribute('aria-label'))
          .filter((label): label is string => label !== rootLabel && label !== null);
        expect(childLabels.length).toBeGreaterThan(0);
        for (const childLabel of childLabels) {
          cleanup();
          await openMapMenu();
          const parent = screen
            .getAllByRole('menuitem')
            .find((item) => item.getAttribute('aria-label') === rootLabel);
          expect(parent).toBeDefined();
          if (!parent) throw new Error(`Родительская кнопка меню не найдена: ${rootLabel}`);
          fireEvent.keyDown(parent, { key: 'Enter' });
          const child = screen
            .getAllByRole('menuitem')
            .find((item) => item.getAttribute('aria-label') === childLabel);
          expect(child).toBeDefined();
          if (!child) throw new Error(`Дочерняя кнопка меню не найдена: ${childLabel}`);
          const childBefore = harness.commands.length;
          fireEvent.keyDown(child, { key: 'Enter' });
          expectCommand(childBefore);
        }
      } else {
        expectCommand(before);
      }
    }

    expect(harness.commands.some((command) => command.t === 'split')).toBe(true);
    expect(menu.isConnected).toBe(false);
  });

  it('1: совместимый стек показывает merge и отправляет два unitIds', async () => {
    await openMapMenu('stack');
    const merge = screen.getByRole('menuitem', { name: /Слить|Merge/i });

    fireEvent.keyDown(merge, { key: 'Enter' });

    expect(harness.commands.at(-1)).toMatchObject({
      t: 'merge',
      unitIds: expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    });
    expect((harness.commands.at(-1) as Extract<Command, { t: 'merge' }>).unitIds).toHaveLength(2);
  });

  it('1: артиллерийская фикстура показывает bombard без merge и отправляет автоцель', async () => {
    await openMapMenu('artillery');
    const rootLabels = screen
      .getAllByRole('menuitem')
      .map((item) => item.getAttribute('aria-label'));
    const bombard = screen.getByRole('menuitem', { name: /Огонь: автоцель|Auto fire/i });

    expect(rootLabels).toContain(bombard.getAttribute('aria-label'));
    expect(screen.queryByRole('menuitem', { name: /Слить|Merge/i })).toBeNull();

    fireEvent.keyDown(bombard, { key: 'Enter' });

    expect(harness.commands.at(-1)).toEqual({
      t: 'bombard',
      unitId: expect.any(Number),
      targetUnitId: null,
    });
  });

  it('2: удержание карточки ArmyBar не открывает меню', async () => {
    await renderSurface();
    const card = armyCard();
    fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: 40, clientY: 40 });
    await new Promise((resolve) => setTimeout(resolve, RADIAL_MENU_LONG_PRESS_MS + 10));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('3: Escape и клик вне меню отменяют меню без send', async () => {
    await openMapMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(harness.commands).toEqual([]);

    cleanup();
    const { menu } = await openMapMenu();
    fireEvent.pointerDown(document.body, { clientX: 0, clientY: 0 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menu.isConnected).toBe(false);
    expect(harness.commands).toEqual([]);
  });

  it('4: UnitCard не возвращает плоские Orders или ArmyPlates', () => {
    const source = readFileSync(join(process.cwd(), 'apps/client/src/dev/UnitCard.tsx'), 'utf8');
    expect(source).not.toMatch(/Orders|ArmyPlates/);
  });
});
