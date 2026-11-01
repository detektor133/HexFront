import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, type MapStatic, type PlayerView } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { armyName } from '../src/dev/army-name.ts';
import type * as SandboxSelection from '../src/dev/sandbox-selection.ts';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { createGesture } from '../src/render/gesture.ts';
import { pixelToHex, type Point } from '../src/render/hex-geometry.ts';
import { attachInput } from '../src/render/map-view.ts';
import type { MapView, MapViewOptions, TapKind } from '../src/render/map-view.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function viewWithTwoArmiesOnOneHex() {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const source = engine.snapshot().view;
  const own = source.units.filter((unit) => unit.owner === source.playerId).slice(0, 2);
  const firstArmy = source.armies[0];
  if (own.length !== 2 || !firstArmy) {
    throw new Error('Нужны два своих отряда и одна армия');
  }
  const armies = [firstArmy, { ...firstArmy, id: firstArmy.id + 1, number: firstArmy.number + 1 }];
  const units = own.map((unit, index) => ({
    ...unit,
    armyId: armies[index]?.id ?? null,
    hex: own[0]?.hex ?? unit.hex,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
  }));
  return { view: { ...source, units, armies }, armies, units };
}

describe('07/T17aj: выбор армии через панель', () => {
  it('07/T17bkfa: кнопка ▶ отправляет startOffensive для своей армии', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const target = armies[0];
    if (!target) throw new Error('Целевая армия не найдена');
    const send = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );

    render(
      createElement(ArmyBar, {
        view: {
          ...view,
          plans: [
            ...view.plans,
            {
              armyId: target.id,
              kind: 'front',
              edges: [],
              hexes: [],
              offensive: { edges: [], hexes: [], active: false, progressTick: 0, taken: [] },
              zone: [],
              stuck: false,
              facing: [],
              lost: [],
              startWanted: false,
            },
          ],
        },
        selected: null,
        partial: [],
        onSelect: vi.fn(),
        send,
        onPick: vi.fn(),
        tool: null,
        onTool: vi.fn(),
      }),
    );

    const targetName = armyName(target);
    const armyCard = screen.getByText(targetName, { exact: true }).closest('[class*="card"]');
    expect(armyCard).toBeTruthy();
    const startButton = armyCard?.querySelector<HTMLButtonElement>('button[aria-label="Начать"]');
    expect(startButton).toBeTruthy();
    if (!startButton) throw new Error('Кнопка «Начать» целевой армии не найдена');

    fireEvent.click(startButton);

    expect(send).toHaveBeenCalledWith({ t: 'startOffensive', armyId: target.id });
  });

  it('07/T17bkfb: кнопка ■ отправляет stopOffensive для своей армии', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const target = armies[0];
    if (!target) throw new Error('Целевая армия не найдена');
    const send = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );

    render(
      createElement(ArmyBar, {
        view: {
          ...view,
          plans: [
            ...view.plans,
            {
              armyId: target.id,
              kind: 'front',
              edges: [],
              hexes: [],
              offensive: { edges: [], hexes: [], active: true, progressTick: 0, taken: [] },
              zone: [],
              stuck: false,
              facing: [],
              lost: [],
              startWanted: true,
            },
          ],
        },
        selected: null,
        partial: [],
        onSelect: vi.fn(),
        send,
        onPick: vi.fn(),
        tool: null,
        onTool: vi.fn(),
      }),
    );

    const targetName = armyName(target);
    const armyCard = screen.getByText(targetName, { exact: true }).closest('[class*="card"]');
    expect(armyCard).toBeTruthy();
    const stopButton = armyCard?.querySelector<HTMLButtonElement>('button[aria-label="Стоп"]');
    expect(stopButton).toBeTruthy();
    if (!stopButton) throw new Error('Кнопка «Стоп» целевой армии не найдена');

    fireEvent.click(stopButton);

    expect(send).toHaveBeenCalledWith({ t: 'stopOffensive', armyId: target.id });
  });

  it('обычный клик по каждой карточке выбирает её armyId', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const onSelect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );

    render(
      createElement(ArmyBar, {
        view,
        selected: null,
        partial: [],
        onSelect,
        send: vi.fn(),
        onPick: vi.fn(),
        tool: null,
        onTool: vi.fn(),
      }),
    );

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[class*="pick"]'));
    expect(cards).toHaveLength(2);
    for (const [index, army] of armies.entries()) {
      const card = cards[index];
      if (!card) throw new Error(`Карточка армии ${army.id} не найдена`);
      fireEvent.click(card);
      expect(onSelect).toHaveBeenLastCalledWith(army.id);
    }
  });

  it('07/T17bkd: ПКМ по каждой карточке выбирает её armyId и отменяет браузерное меню', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const onSelect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );

    render(
      createElement(ArmyBar, {
        view,
        selected: null,
        partial: [],
        onSelect,
        send: vi.fn(),
        onPick: vi.fn(),
        tool: null,
        onTool: vi.fn(),
      }),
    );

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[class*="pick"]'));
    expect(cards).toHaveLength(2);
    for (const [index, army] of armies.entries()) {
      const card = cards[index];
      if (!card) throw new Error(`Карточка армии ${army.id} не найдена`);
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      card.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(onSelect).toHaveBeenLastCalledWith(army.id);
    }
  });
});

describe('07/T17aj: выбор фишки на карте', () => {
  it('держит фишки отрядов разных армий отдельно с доступным промежутком', () => {
    const { view, units } = viewWithTwoArmiesOnOneHex();
    const loaded = loadMap(mapJson);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const layer = createUnitLayer(loaded.map.width, 10, () => ({ x: 0, y: 0 }));
    try {
      layer.setView(view, { hex: null, units: [], target: null }, 0);
      expect(layer.unitsAt(layer.chipAt(units[0]?.hex ?? 0))).toEqual([]);
      const chipsLayer = layer.container.children[0];
      if (!(chipsLayer instanceof Container)) throw new Error('Слой фишек не найден');
      const positions = chipsLayer.children.slice(1).map((chip) => chip.position);
      expect(positions).toHaveLength(2);
      const [first, second] = positions;
      if (!first || !second) throw new Error('Нужны две отдельные фишки');
      const ordered = [first, second].sort((a, b) => a.y - b.y);
      expect(layer.unitsAt(ordered[0] ?? { x: 0, y: 0 })).toEqual([
        Math.min(...units.map((unit) => unit.id)),
      ]);
      expect(layer.unitsAt(ordered[1] ?? { x: 0, y: 0 })).toEqual([
        Math.max(...units.map((unit) => unit.id)),
      ]);
      expect(layer.unitsAt({ x: 0, y: (first.y + second.y) / 2 })).toEqual([]);
    } finally {
      layer.destroy();
    }
  });

  it('через MatchPage и onTap не выбирает фишки по промежутку между ними', async () => {
    const sourceView = viewWithTwoArmiesOnOneHex();
    const first = sourceView.units[0];
    if (!first) throw new Error('Фикстуре нужен исходный отряд');
    const third = { ...first, id: first.id + 10_000, type: 'artillery' as const };
    const units = [...sourceView.units, third];
    const view = { ...sourceView.view, units };
    const sourceEngine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in sourceEngine) throw new Error(sourceEngine.errors.join('; '));
    const source = sourceEngine.snapshot();
    const message: FromWorker = {
      ...source,
      view,
      snapshot: { ...source.snapshot, view },
    };
    let canvas: HTMLCanvasElement | undefined;
    const strokeEvents: string[] = [];
    let layer:
      | {
          chipAt(hex: number): Point;
          chipBounds(
            unitId: number,
          ): { left: number; right: number; top: number; bottom: number } | null;
          unitsAt(world: Point): readonly number[];
          setView(
            view: PlayerView,
            picked: { hex: null; units: number[]; target: null },
            nowMs: number,
          ): void;
        }
      | undefined;
    const selectUnitsSpy = vi.fn();

    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _setup: unknown,
        emit: (next: FromWorker) => void,
      ): LocalMatch => {
        emit(message);
        return {
          send: vi.fn(),
          setFog: vi.fn(),
          setPaused: vi.fn(),
          step: vi.fn(),
          setSpeed: vi.fn(),
          setObserver: vi.fn(),
          setView: vi.fn(),
          select: vi.fn(),
          ack: vi.fn(),
          dispose: vi.fn(),
        };
      },
    }));
    vi.doMock('../src/dev/sandbox-selection.ts', async () => {
      const actual = await vi.importActual<typeof SandboxSelection>(
        '../src/dev/sandbox-selection.ts',
      );
      selectUnitsSpy.mockImplementation(actual.selectUnits);
      return { ...actual, selectUnits: selectUnitsSpy };
    });
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
      ): Promise<MapView> => {
        layer = options.midLayer?.(map, 10) as typeof layer;
        canvas = document.createElement('canvas');
        canvas.getBoundingClientRect = () => ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 1000,
          bottom: 1000,
          width: 1000,
          height: 1000,
          toJSON: () => ({}),
        });
        canvas.setPointerCapture = () => undefined;
        host.appendChild(canvas);
        const gesture = createGesture(
          {
            drawing: () => true,
            press: () => undefined,
            release: () => undefined,
            canHold: () => false,
            cancelZone: () => false,
            inside: () => true,
          },
          (event) => {
            if (event.t === 'tap')
              handler(pixelToHex(event.at, options.radius), event.kind, event.at);
            if (event.t === 'stroke') strokeEvents.push(event.phase);
          },
        );
        const detach = attachInput(canvas, gesture, {
          zoom: () => undefined,
          pressed: () => undefined,
          idle: () => undefined,
        });
        return {
          configure: () => undefined,
          setScale: () => undefined,
          setBottomInset: () => undefined,
          setTopInset: () => undefined,
          centerOn: () => undefined,
          setStroke: () => undefined,
          setSelection: () => undefined,
          setGrab: () => undefined,
          setOrderHooks: () => undefined,
          cancel: () => undefined,
          sceneStats: () => ({
            objects: 0,
            text: 0,
            graphics: 0,
            graphicsInstructions: [],
            graphicsDetails: [],
            textures: 0,
            canvasTextTextures: null,
          }),
          destroy: () => {
            detach();
            canvas?.remove();
          },
        } as MapView;
      },
    }));

    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);
    await waitFor(() => {
      expect(canvas).toBeDefined();
      expect(layer).toBeDefined();
    });

    if (!canvas || !layer) throw new Error('Реальный путь карты не инициализирован');
    const loadedMap = loadMap(mapJson);
    if (!loadedMap.ok) throw new Error(loadedMap.errors.join('; '));
    const activeCanvas = canvas;
    for (const unit of units) {
      const bounds = layer.chipBounds(unit.id);
      if (!bounds) throw new Error(`Фишка отряда ${unit.id} не создана`);
      const point = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
      expect(layer.unitsAt(point)).toEqual([unit.id]);
      act(() => {
        fireEvent.pointerDown(activeCanvas, {
          pointerId: 1,
          button: 0,
          clientX: point.x,
          clientY: point.y,
        });
        fireEvent.pointerUp(activeCanvas, {
          pointerId: 1,
          button: 0,
          clientX: point.x,
          clientY: point.y,
        });
      });
      expect(selectUnitsSpy).toHaveBeenLastCalledWith(view, expect.anything(), [unit.id]);
    }
    const centers = units.map((unit) => {
      const bounds = layer?.chipBounds(unit.id);
      if (!bounds) throw new Error(`Фишка отряда ${unit.id} не найдена`);
      return (bounds.top + bounds.bottom) / 2;
    });
    const gap = { x: layer.chipAt(first.hex).x, y: ((centers[0] ?? 0) + (centers[1] ?? 0)) / 2 };
    expect(layer.unitsAt(gap)).toEqual([]);
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        button: 0,
        clientX: gap.x,
        clientY: gap.y,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        button: 0,
        clientX: gap.x,
        clientY: gap.y,
      });
    });
    expect(selectUnitsSpy).toHaveBeenCalledTimes(3);

    const selectedId = third.id;
    const movingView = {
      ...view,
      units: units.map((unit) =>
        unit.id === selectedId
          ? { ...unit, order: 'move' as const, path: [unit.hex + 1], moveTicks: 1, moveTotal: 10 }
          : unit,
      ),
    };
    const nowMs = 1_000;
    act(() => layer?.setView(movingView, { hex: null, units: [selectedId], target: null }, nowMs));
    const movingBounds = layer.chipBounds(selectedId);
    if (!movingBounds) throw new Error('Движущаяся фишка не найдена');
    const movingPoint = {
      x: (movingBounds.left + movingBounds.right) / 2,
      y: (movingBounds.top + movingBounds.bottom) / 2,
    };
    expect(Number.isFinite(movingPoint.x) && Number.isFinite(movingPoint.y)).toBe(true);
    expect(layer.unitsAt(movingPoint)).toEqual([selectedId]);
    const pickedBeforeDrag = selectUnitsSpy.mock.results.at(-1)?.value;
    expect(pickedBeforeDrag).toEqual({
      hex: null,
      units: [selectedId],
      target: null,
    });
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        button: 0,
        clientX: movingPoint.x,
        clientY: movingPoint.y,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 1,
        button: 0,
        clientX: movingPoint.x + 12,
        clientY: movingPoint.y,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        button: 0,
        clientX: movingPoint.x + 12,
        clientY: movingPoint.y,
      });
    });
    expect(strokeEvents).toEqual(['start', 'move', 'end']);
    expect(selectUnitsSpy).toHaveBeenCalledTimes(3);
    expect(selectUnitsSpy.mock.results.at(-1)?.value).toBe(pickedBeforeDrag);
  });
});

describe('07/T17bkc: переименование карточки армии', () => {
  it('сохраняет переименование по Enter и blur, отменяет Escape и соблюдает правила имени', () => {
    const { view, armies } = viewWithTwoArmiesOnOneHex();
    const send = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );
    const props = {
      view,
      selected: null,
      partial: [],
      onSelect: vi.fn(),
      send,
      onPick: vi.fn(),
      tool: null,
      onTool: vi.fn(),
    };
    const { rerender } = render(createElement(ArmyBar, props));
    const first = armies[0];
    const second = armies[1];
    if (!first || !second) throw new Error('Фикстура должна содержать две армии');
    const firstName = armyName(first);
    const secondName = armyName(second);
    const clickName = (name: string): void => {
      const button = screen
        .getAllByRole('button', { name })
        .find((element) => element.tagName === 'BUTTON');
      if (!button) throw new Error(`Кнопка названия армии «${name}» не найдена`);
      fireEvent.click(button);
    };

    clickName(firstName);
    const enterInput = screen.getByRole('textbox', { name: 'Название армии' });
    expect((enterInput as HTMLInputElement).maxLength).toBe(20);
    fireEvent.change(enterInput, { target: { value: 'Новый флот' } });
    fireEvent.keyDown(enterInput, { key: 'Enter' });
    expect(send).toHaveBeenLastCalledWith({
      t: 'renameArmy',
      armyId: first.id,
      name: 'Новый флот',
    });

    clickName(secondName);
    const blurInput = screen.getByRole('textbox', { name: 'Название армии' });
    fireEvent.change(blurInput, { target: { value: 'Флот резерва' } });
    fireEvent.blur(blurInput);
    expect(send).toHaveBeenLastCalledWith({
      t: 'renameArmy',
      armyId: second.id,
      name: 'Флот резерва',
    });

    clickName(firstName);
    const escapeInput = screen.getByRole('textbox', { name: 'Название армии' });
    fireEvent.change(escapeInput, { target: { value: 'Отменить' } });
    const callsBeforeEscape = send.mock.calls.length;
    fireEvent.keyDown(escapeInput, { key: 'Escape' });
    expect(send).toHaveBeenCalledTimes(callsBeforeEscape);
    expect(screen.queryByRole('textbox', { name: 'Название армии' })).toBeNull();

    rerender(
      createElement(ArmyBar, {
        ...props,
        view: { ...view, armies: [{ ...first, name: '' }, second] },
      }),
    );
    const numberedName = armyName({ ...first, name: '' });
    clickName(numberedName);
    const emptyInput = screen.getByRole('textbox', { name: 'Название армии' });
    fireEvent.change(emptyInput, { target: { value: '   ' } });
    fireEvent.keyDown(emptyInput, { key: 'Enter' });
    expect(send).toHaveBeenLastCalledWith({ t: 'renameArmy', armyId: first.id, name: '' });
    expect(screen.getByText(numberedName).textContent).toBe(numberedName);

    clickName(numberedName);
    const limitedInput = screen.getByRole('textbox', { name: 'Название армии' });
    fireEvent.change(limitedInput, { target: { value: '123456789012345678901' } });
    fireEvent.keyDown(limitedInput, { key: 'Enter' });
    expect(send).toHaveBeenLastCalledWith({
      t: 'renameArmy',
      armyId: first.id,
      name: '12345678901234567890',
    });
  });
});
