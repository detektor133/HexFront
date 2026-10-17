import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap, type ConstructionCheck, type MapStatic } from '@hexfront/sim';

import { HexCard } from '../src/dev/HexCard.tsx';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, MapViewState, TapKind } from '../src/render/map-view.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T17m: карточка клетки', () => {
  it('проходит путь тапа по карте через selection, обновляет и закрывает карточку', async () => {
    let tap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const initial = engine.snapshot();
    const neutralHexes = initial.view.hexes.owner
      .map((owner, hex) => (owner === -1 ? hex : -1))
      .filter((hex) => hex >= 0);
    const firstHex = neutralHexes[0];
    const secondHex = engine.state.cities.find((city) => city.hex !== firstHex)?.hex;
    if (firstHex === undefined || secondHex === undefined) {
      throw new Error('нейтральные клетки для выбора не найдены');
    }
    const emit = (onMessage: (message: FromWorker) => void): void => onMessage(engine.snapshot());

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mapJson }) as Response),
    );
    vi.doMock('../src/local/local-match.ts', () => ({
      startLocalMatch: (
        _map: unknown,
        _seed: number,
        _players: unknown,
        onMessage: (message: FromWorker) => void,
      ): LocalMatch => {
        emit(onMessage);
        return {
          send: () => undefined,
          setFog: (fog) => {
            engine.setFog(fog);
            emit(onMessage);
          },
          setPaused: () => undefined,
          step: () => undefined,
          setSpeed: () => undefined,
          setObserver: (playerId) => {
            engine.setObserver(playerId);
            emit(onMessage);
          },
          setView: (playerId, fog) => {
            engine.setView(playerId, fog);
            emit(onMessage);
          },
          select: (hex) => {
            engine.select(hex);
            emit(onMessage);
          },
          ack: () => undefined,
          dispose: () => undefined,
        };
      },
    }));
    vi.doMock('../src/render/map-view.ts', () => ({
      createMapView: async (
        _host: HTMLElement,
        _map: MapStatic,
        _initial: MapViewOptions,
        _onState: (state: MapViewState) => void,
        onTap?: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
      ): Promise<MapView> => {
        tap = onTap;
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
        };
      },
    }));
    const measuredHeights: number[] = [];
    class MatchResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}

      public observe(target: Element): void {
        const height = target.className.toString().includes('card') ? 248 : 0;
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: height });
        this.callback(
          [{ target, contentRect: { height: 0 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
        if (height > 0) measuredHeights.push(height);
      }

      public disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', MatchResizeObserver);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    window.history.replaceState({}, '', '/match');
    render(<MatchPage />);
    await waitFor(() => expect(tap).toBeDefined());
    const select = async (hex: number): Promise<void> => {
      const point = hexFromId(hex, mapResult.map.width);
      act(() => tap?.(point, 'select', { x: 0, y: 0 }));
      act(() => tap?.(point, 'select', { x: 0, y: 0 }));
      await waitFor(() => expect(document.querySelector('section[class*="card"]')).not.toBeNull());
    };
    const clearSelection = (): void => {
      act(() => tap?.({ q: -100, r: -100 }, 'select', { x: 0, y: 0 }));
    };
    const getCard = (): HTMLElement => {
      const card = document.querySelector<HTMLElement>('section[class*="card"]');
      if (!card) throw new Error('карточка клетки не найдена');
      return card;
    };

    await select(firstHex);
    expect(measuredHeights).toContain(248);
    expect(getCard().textContent).toMatch(/Население/u);
    expect(getCard().textContent).toContain('нейтральный');
    const firstTitle = getCard().getAttribute('aria-label');
    const firstContent = getCard().textContent;
    await select(secondHex);
    await waitFor(() => expect(getCard().textContent).not.toBe(firstContent));
    expect(
      getCard().getAttribute('aria-label') !== firstTitle || getCard().textContent !== firstContent,
    ).toBe(true);
    clearSelection();
    expect(document.querySelector('section[class*="card"]')).toBeNull();
  });

  it('показывает данные своей клетки и города', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const capital = engine.state.cities.find((city) => city.owner === 0);
    if (!capital) throw new Error('столица игрока не найдена');
    engine.select(capital.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );

    expect(screen.getByText(/Столица/u)).toBeTruthy();
    expect(screen.getByText('вы')).toBeTruthy();
    expect(screen.getByText('Население')).toBeTruthy();
    expect(screen.getByText('Рост')).toBeTruthy();
    expect(screen.getByText('Снабжение')).toBeTruthy();
    expect(screen.getByText('Золото')).toBeTruthy();

    const city = message.selection.city;
    if (!city) throw new Error('город для подготовленных данных не найден');
    const improvements = message.view.hexes.improvement.slice();
    improvements[city.hex] = 2;
    const preparedView = {
      ...message.view,
      hexes: { ...message.view.hexes, improvement: improvements },
      constructions: [
        {
          id: 1,
          owner: 0,
          hex: city.hex,
          kind: 'upgradeCity',
          progressTicks: 2,
          totalTicks: 10,
          path: [],
        },
        {
          id: 2,
          owner: 0,
          hex: city.hex,
          kind: 'road',
          progressTicks: 1,
          totalTicks: 3,
          path: [city.hex],
        },
      ] as (typeof message.view.constructions)[number][],
      recruits: [
        {
          id: 1,
          cityId: city.id,
          type: 'infantry',
          soldiers: 1000,
          progressTicks: 2,
          totalTicks: 10,
        },
      ] as (typeof message.view.recruits)[number][],
    };
    const ready = { ok: true, cost: 1, timeS: 1 } as unknown as ConstructionCheck;
    const readyRebuild = {
      ok: true,
      cityHex: city.hex,
      path: [city.hex],
      toBuild: [],
      cost: 1,
      affordable: true,
    } as unknown as typeof city.rebuild;
    const preparedSelection = {
      ...message.selection,
      city: {
        ...city,
        roadJob: { built: 1, total: 3 },
        upgrade: ready,
        rebuild: readyRebuild,
      },
    };
    cleanup();
    render(
      <HexCard
        s={preparedSelection}
        view={preparedView}
        map={mapResult.map}
        send={() => undefined}
      />,
    );
    expect(screen.getByText(/Благоустройство, ур\./u)).toBeTruthy();
    expect(screen.getByText(/Строится/u)).toBeTruthy();
    expect(screen.getByText(/Прокладка дороги/u)).toBeTruthy();
    expect(screen.getByText(/Набор/u)).toBeTruthy();

    // Без активной стройки на гексе (не busy) видны и свои кнопки города.
    cleanup();
    render(
      <HexCard
        s={preparedSelection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /Улучшить город/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Проложить дорогу/u })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);

    const prepared = {
      ...message.selection,
      city: null,
      foundCity: ready,
      improve: ready,
      fort: ready,
      depot: ready,
    };
    cleanup();
    render(<HexCard s={prepared} view={message.view} map={mapResult.map} send={() => undefined} />);
    const plainButtons = screen.getAllByRole('button');
    expect(plainButtons).toHaveLength(4);
    expect(plainButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Основать город'),
      expect.stringContaining('Благоустроить'),
      expect.stringContaining('Укрепление'),
      expect.stringContaining('Склад'),
    ]);
    expect(screen.queryByRole('button', { name: /Улучшить город/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Проложить дорогу/u })).toBeNull();
  });

  it('берёт высоту из scrollHeight, если ResizeObserver сообщает нулевой contentRect', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const capital = engine.state.cities.find((city) => city.owner === 0);
    if (!capital) throw new Error('столица игрока не найдена');
    engine.select(capital.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');
    const heights: number[] = [];
    class ZeroRectResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}

      public observe(target: Element): void {
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: 248 });
        this.callback(
          [{ target, contentRect: { height: 0 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      public disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ZeroRectResizeObserver);

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
        onHeight={(height) => heights.push(height)}
      />,
    );

    expect(heights).toEqual([248]);
  });

  it('не показывает сведения и действия чужого fogged-гекса', () => {
    const engine = createLocalEngine(mapJson, 42, 2, [], true);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const foreign = engine.state.cities.find((city) => city.owner === 1);
    if (!foreign) throw new Error('чужой город не найден');
    engine.select(foreign.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );

    expect(screen.getByText('соперник')).toBeTruthy();
    expect(screen.queryByText(/Столица/u)).toBeNull();
    expect(screen.queryByText('Снабжение')).toBeNull();
    expect(screen.queryByText('Золото')).toBeNull();
    expect(screen.queryByText(/Строительство/u)).toBeNull();
    expect(screen.queryByText(/Набор/u)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('не раскрывает fogged-нейтральную клетку и не ломает UnitCard', () => {
    const engine = createLocalEngine(mapJson, 42, 2, [], true);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const initial = engine.snapshot();
    const neutralHex = initial.view.hexes.owner.findIndex(
      (owner, index) => owner === -1 && initial.view.hexes.visible[index] === 0,
    );
    const unit = initial.view.units.find((item) => item.owner === 0);
    if (neutralHex < 0 || !unit) throw new Error('нейтральный гекс или свой отряд не найден');

    engine.select(neutralHex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор нейтральной клетки не создан');
    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );
    expect(screen.getByText('нейтральный')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    render(
      <UnitCard
        view={message.view}
        map={mapResult.map}
        picked={{ hex: null, units: [unit.id], target: null }}
        send={() => undefined}
        onPick={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'В армию' })).toBeTruthy();
  });

  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])('держит карточку над панелью армий в границах экрана: %dx%d', (width, height) => {
    const layout = computeMatchLayout({
      viewport: { width, height },
      hudHeight: 48,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardHeight: 0,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
    const card = layout.elements.find((element) => element.id === 'card');
    const dock = layout.elements.find((element) => element.id === 'bottom-panel');
    if (!card || !dock) throw new Error('карточка или панель армий не попали в раскладку');
    expect(validateMatchLayout(layout)).toEqual([]);
    expect(card.height).toBeGreaterThan(0);
    expect(card.y + card.height).toBeLessThanOrEqual(dock.y);
  });
});
