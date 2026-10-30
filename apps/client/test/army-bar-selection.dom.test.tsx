import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type MapStatic } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { armyName } from '../src/dev/army-name.ts';
import type * as SandboxSelection from '../src/dev/sandbox-selection.ts';
import { createUnitLayer } from '../src/dev/unit-layer.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import type { Point } from '../src/render/hex-geometry.ts';
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
  it('возвращает оба отряда одной тесной фишки, не различая армии', () => {
    const { view, units } = viewWithTwoArmiesOnOneHex();
    const loaded = loadMap(mapJson);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const layer = createUnitLayer(loaded.map.width, 10, () => ({ x: 0, y: 0 }));
    try {
      layer.setView(view, { hex: null, units: [], target: null }, 0);
      const point = layer.chipAt(units[0]?.hex ?? 0);
      expect(layer.unitsAt(point)).toEqual(units.map((unit) => unit.id));
    } finally {
      layer.destroy();
    }
  });

  it('через MatchPage и onTap выбирает весь тесный чип, а не отдельную армию', async () => {
    const { view, units } = viewWithTwoArmiesOnOneHex();
    const sourceEngine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in sourceEngine) throw new Error(sourceEngine.errors.join('; '));
    const source = sourceEngine.snapshot();
    const message: FromWorker = {
      ...source,
      view,
      snapshot: { ...source.snapshot, view },
    };
    const selectedCalls: readonly number[] = units.map((unit) => unit.id);
    let onTap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
    let layer: { chipAt(hex: number): Point } | undefined;
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
        _host: HTMLElement,
        map: MapStatic,
        options: MapViewOptions,
        _state: unknown,
        handler: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
      ): Promise<MapView> => {
        layer = options.midLayer?.(map, 10) as { chipAt(hex: number): Point } | undefined;
        onTap = handler;
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
          destroy: () => undefined,
        } as MapView;
      },
    }));

    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);
    await waitFor(() => {
      expect(onTap).toBeDefined();
      expect(layer).toBeDefined();
    });

    const firstUnit = units[0];
    if (!firstUnit || !onTap || !layer) throw new Error('Реальный путь карты не инициализирован');
    const loadedMap = loadMap(mapJson);
    if (!loadedMap.ok) throw new Error(loadedMap.errors.join('; '));
    const hex = hexFromId(firstUnit.hex, loadedMap.map.width);
    const point = layer.chipAt(firstUnit.hex);
    act(() => onTap?.(hex, 'select', point));
    await waitFor(() =>
      expect(selectUnitsSpy).toHaveBeenCalledWith(view, expect.anything(), selectedCalls),
    );
    expect(selectUnitsSpy.mock.calls.at(-1)?.[2]).toEqual(selectedCalls);
    expect(selectUnitsSpy.mock.results.at(-1)?.value.units).toEqual(selectedCalls);

    act(() => onTap?.(hex, 'select', { x: point.x + 1, y: point.y }));
    expect(selectUnitsSpy.mock.calls.at(-1)?.[2]).toEqual(selectedCalls);
    expect(selectUnitsSpy.mock.results.at(-1)?.value.units).toEqual([]);
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
