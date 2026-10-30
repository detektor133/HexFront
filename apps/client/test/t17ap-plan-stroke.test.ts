// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { Container } from 'pixi.js';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  borderEdges,
  defenseLinePath,
  edgeCorners,
  FP,
  hexFromId,
  hexId,
  loadMap,
  neighbors,
  TERRAIN,
  type Command,
  type EdgeId,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { armyName } from '../src/dev/army-name.ts';
import { cityChipShift } from '../src/dev/chip-place.ts';
import { edgeMid } from '../src/dev/plan-edges.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { MatchSurface } from '../src/match/MatchSurface.tsx';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<Record<string, unknown>>();
  const PixiContainer = pixi.Container as typeof Container;
  class TestApplication {
    readonly canvas = document.createElement('canvas');
    readonly stage = new PixiContainer();
    readonly ticker = {
      callbacks: [] as Array<(value: { deltaMS: number; FPS: number }) => void>,
      add: (callback: (value: { deltaMS: number; FPS: number }) => void): void => {
        this.ticker.callbacks.push(callback);
      },
    };
    readonly renderer = { texture: { managedTextures: [] as readonly unknown[] } };
    screen = { width: 390, height: 844 };

    constructor() {
      (globalThis as Record<string, unknown>).__t17apApplication = this;
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
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/europe.json'), 'utf8'),
);
const radius = tokens.map.hexRadius;

const harness = vi.hoisted(() => ({
  commands: [] as Command[],
  view: null as PlayerView | null,
  canvas: null as HTMLCanvasElement | null,
  app: null as {
    stage: Container;
    ticker: { callbacks: Array<(value: { deltaMS: number; FPS: number }) => void> };
  } | null,
}));

class TestWorker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

  public postMessage(message: {
    readonly t: string;
    readonly map?: unknown;
    readonly seed?: number;
    readonly players?: number;
    readonly cmd?: Command;
  }): void {
    if (message.cmd) {
      harness.commands.push(message.cmd);
      return;
    }
    if (message.t !== 'start') return;
    const engine = createLocalEngine(message.map, message.seed ?? 42, message.players ?? 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const snapshot = engine.snapshot();
    harness.view = snapshot.view;
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          t: 'view',
          kind: 'snapshot',
          snapshot: { t: 'snapshot', tick: snapshot.view.tick, view: snapshot.view },
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

function mapAndView(): { readonly map: MapStatic; readonly view: PlayerView } {
  const loaded = loadMap(mapJson);
  if (!loaded.ok || !harness.view) throw new Error('Фикстура матча не загружена');
  return { map: loaded.map, view: harness.view };
}

function worldPoint(
  world: Container,
  point: { readonly x: number; readonly y: number },
): { readonly clientX: number; readonly clientY: number } {
  const screen = world.toGlobal(point);
  return { clientX: screen.x, clientY: screen.y };
}

function continuousEdges(edges: readonly EdgeId[]): boolean {
  return edges.every(
    (edge, index) =>
      index === 0 ||
      edgeCorners(edge).some((corner) =>
        edgeCorners(edges[index - 1] as EdgeId).some(
          (previous) => previous.hex === corner.hex && previous.a === corner.a,
        ),
      ),
  );
}

function findFrontScenario(
  map: MapStatic,
  view: PlayerView,
): { points: Array<{ x: number; y: number }>; edges: EdgeId[] } {
  const edges = borderEdges({ map, hexes: view.hexes }, view.playerId);
  for (const first of edges)
    for (const second of edges)
      for (const third of edges) {
        const candidate = [first, second, third];
        if (new Set(candidate).size === 3 && continuousEdges(candidate)) {
          return {
            points: [edgeMid(map, radius, first), edgeMid(map, radius, third)],
            edges: candidate,
          };
        }
      }
  throw new Error('Не найден непрерывный фронт из трёх граней');
}

function findLineScenario(
  map: MapStatic,
  view: PlayerView,
): { points: Array<{ x: number; y: number }>; hexes: number[] } {
  const own = view.hexes.owner
    .map((owner, id) => (owner === view.playerId && map.terrain[id] !== TERRAIN.water ? id : -1))
    .filter((id) => id >= 0);
  for (const first of own) {
    for (const last of own) {
      const path = defenseLinePath({ map, hexes: view.hexes }, view.playerId, [first, last]);
      if (path && path.length >= 3) {
        return {
          points: [
            hexCenter(hexFromId(first, map.width), radius),
            hexCenter(hexFromId(last, map.width), radius),
          ],
          hexes: path,
        };
      }
    }
  }
  throw new Error('Не найдена удалённая линия обороны из трёх гексов');
}

function findBlockedLineScenario(
  map: MapStatic,
  view: PlayerView,
): { points: Array<{ x: number; y: number }>; first: number; last: number } {
  const own = view.hexes.owner
    .map((owner, id) => (owner === view.playerId && map.terrain[id] !== TERRAIN.water ? id : -1))
    .filter((id) => id >= 0);
  for (const first of own)
    for (let last = 0; last < map.terrain.length; last += 1) {
      if (first === last || map.terrain[last] === TERRAIN.water) continue;
      const originalOwner = view.hexes.owner[last];
      view.hexes.owner[last] = view.playerId;
      const path = defenseLinePath({ map, hexes: view.hexes }, view.playerId, [first, last]);
      view.hexes.owner[last] = originalOwner as number;
      if (path === null) {
        return {
          points: [
            hexCenter(hexFromId(first, map.width), radius),
            hexCenter(hexFromId(4478, map.width), radius),
            hexCenter(hexFromId(last, map.width), radius),
          ],
          first,
          last,
        };
      }
    }
  throw new Error('Не найден недопустимый участок линии обороны');
}

function blockedFrontScenario(): {
  points: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  prefix: EdgeId[];
  suffix: EdgeId;
} {
  // Фиксированные координаты europe.json: допустимый префикс, внутренняя запрещённая точка,
  // затем допустимый суффикс. Поиск этой геометрии в каждом тесте превышал лимит CI.
  return {
    points: [
      { x: 2085, y: 1948.5571585149867 },
      { x: 2077.5, y: 1948.5571585149867 },
      { x: 2250, y: 1645.4482671904332 },
      { x: 2085, y: 1965.8776665906755 },
    ],
    prefix: [26407 as EdgeId],
    suffix: 26406 as EdgeId,
  };
}

async function renderSurface(): Promise<{
  readonly map: MapStatic;
  readonly view: PlayerView;
  readonly world: Container;
}> {
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(mapJson), { status: 200 })),
  );
  render(createElement(MatchSurface, { debug: true }));
  await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
  const app = (globalThis as Record<string, unknown>).__t17apApplication as typeof harness.app;
  if (!app) throw new Error('Pixi Application не создан');
  harness.app = app;
  app.ticker.callbacks.forEach((callback) => callback({ deltaMS: 0, FPS: 60 }));
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas MapView не найден');
  harness.canvas = canvas;
  const world = app.stage.children[0];
  if (!(world instanceof Container)) throw new Error('Слой мира MapView не создан');
  return { ...mapAndView(), world };
}

async function selectArmy(): Promise<void> {
  const card = screen.getAllByRole('button').find((item) => item.className.includes('_pick_'));
  if (!card) throw new Error('Карточка армии не найдена');
  fireEvent.click(card);
  await waitFor(() => expect(card.getAttribute('aria-pressed')).toBe('true'));
}

async function chooseTool(label: RegExp): Promise<void> {
  const button = screen.getByRole('button', { name: label });
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
}

function stroke(
  points: readonly { x: number; y: number }[],
  world: Container,
  cancel = false,
): void {
  if (!harness.canvas) throw new Error('Canvas MapView не подключён');
  const start = worldPoint(world, points[0] as { x: number; y: number });
  fireEvent.pointerDown(harness.canvas, { button: 0, pointerId: 17, ...start });
  for (const point of points.slice(1))
    fireEvent.pointerMove(harness.canvas, { pointerId: 17, ...worldPoint(world, point) });
  const finish = worldPoint(world, points.at(-1) as { x: number; y: number });
  if (cancel) fireEvent.click(screen.getByRole('button', { name: /Оборона|Defense/ }));
  else fireEvent.pointerUp(harness.canvas, { pointerId: 17, ...finish });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe(): void {}
      public disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  harness.commands = [];
  harness.view = null;
  harness.canvas = null;
  harness.app = null;
});

afterEach(() => cleanup());

describe('07/T17ap: непрерывный росчерк планов через runtime', () => {
  it('показывает группы при выборе армии и переключает строку на подробную карточку', async () => {
    const { view } = await renderSurface();
    const army = view.armies.find(
      (item) =>
        view.units.filter(
          (unit) =>
            unit.armyId === item.id && unit.owner === view.playerId && unit.order !== 'retreat',
        ).length >= 2,
    );
    if (!army) throw new Error('В фикстуре нет своей армии с двумя отрядами');
    const armyIndex = view.armies.findIndex((item) => item.id === army.id);
    const cards = screen.getAllByRole('button').filter((item) => item.className.includes('_pick_'));
    const armyCard = cards[armyIndex];
    if (!armyCard) throw new Error('Карточка целевой армии отсутствует');
    expect(armyCard.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(armyCard);

    const card = await waitFor(() => {
      const selectedCard = Array.from(
        document.querySelectorAll<HTMLElement>('section[aria-label]'),
      ).find((element) => element.querySelector('ul button'));
      expect(selectedCard).not.toBeNull();
      return selectedCard as HTMLElement;
    });
    expect(card.textContent).toContain(armyName(army));
    expect(card.querySelectorAll('ul button')).toHaveLength(2);
    expect(armyCard.getAttribute('aria-pressed')).toBe('true');

    const row = card.querySelector<HTMLButtonElement>('ul button');
    if (!row) throw new Error('Строка отряда отсутствует');
    fireEvent.click(row);

    await waitFor(() => expect(card.querySelector('ul')).toBeNull());
    expect(card.querySelector('dl')).not.toBeNull();
  });

  it('показывает группы после рамки, охватившей отряды двух армий', async () => {
    const { map, view, world } = await renderSurface();
    const firstArmy = view.armies[0];
    if (!firstArmy) throw new Error('В фикстуре нет первой армии');
    const secondArmy = {
      ...firstArmy,
      id: Math.max(...view.armies.map((army) => army.id)) + 1,
      number: Math.max(...view.armies.map((army) => army.number)) + 1,
      name: 'Тестовая армия',
    };
    (view as { armies: typeof view.armies }).armies = [...view.armies, secondArmy];
    const units = view.units.filter(
      (unit) => unit.owner === view.playerId && unit.order !== 'retreat',
    );
    const centers = units.map((unit) => ({
      unit,
      point: world.toGlobal(hexCenter(hexFromId(unit.hex, map.width), radius)),
    }));
    let pair: (typeof centers)[number][] | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const first of centers) {
      for (const second of centers) {
        if (first.unit.id === second.unit.id) continue;
        const distance = Math.hypot(first.point.x - second.point.x, first.point.y - second.point.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          pair = [first, second];
        }
      }
    }
    if (!pair) throw new Error('Не найдена пара своих отрядов для рамки');
    const [first, second] = pair;
    if (!first || !second || !harness.canvas) throw new Error('Не подготовлена рамка выбора');
    (first.unit as { armyId: number | null }).armyId = firstArmy.id;
    (second.unit as { armyId: number | null }).armyId = secondArmy.id;
    const margin = 12;
    const from = {
      clientX: Math.min(first.point.x, second.point.x) - margin,
      clientY: Math.min(first.point.y, second.point.y) - margin,
    };
    const to = {
      clientX: Math.max(first.point.x, second.point.x) + margin,
      clientY: Math.max(first.point.y, second.point.y) + margin,
    };
    fireEvent.pointerDown(harness.canvas, {
      button: 0,
      pointerId: 31,
      pointerType: 'mouse',
      ...from,
    });
    fireEvent.pointerMove(harness.canvas, { pointerId: 31, ...to });
    fireEvent.pointerUp(harness.canvas, { pointerId: 31, ...to });

    const card = await waitFor(() => {
      const selectedCard = Array.from(
        document.querySelectorAll<HTMLElement>('section[aria-label]'),
      ).find((element) => element.querySelector('ul button'));
      expect(selectedCard).toBeTruthy();
      return selectedCard as HTMLElement;
    });
    expect(card.querySelectorAll('ul button').length).toBeGreaterThanOrEqual(2);
    expect(card.querySelectorAll('h3')).toHaveLength(2);
  });
  it('передаёт через canvas полный непрерывный фронт и точный assignFront', async () => {
    const { map, view, world } = await renderSurface();
    await selectArmy();
    await chooseTool(/Фронт|Front/);
    const scenario = findFrontScenario(map, view);
    stroke(scenario.points, world);
    expect(harness.commands).toEqual([
      { t: 'assignFront', armyId: view.armies[0]?.id, edges: scenario.edges },
    ]);
    expect(scenario.edges).toEqual([scenario.edges[0], scenario.edges[1], scenario.edges[2]]);
    expect(
      scenario.edges.every(
        (edge, index) =>
          index === 0 ||
          edgeCorners(edge).some((corner) =>
            edgeCorners(scenario.edges[index - 1] as EdgeId).some(
              (previous) => previous.hex === corner.hex && previous.a === corner.a,
            ),
          ),
      ),
    ).toBe(true);
  });

  it('передаёт удалённую линию обороны со всеми промежуточными гексами', async () => {
    const { map, view, world } = await renderSurface();
    await selectArmy();
    await chooseTool(/Оборона|Defense/);
    const scenario = findLineScenario(map, view);
    stroke(scenario.points, world);
    expect(harness.commands).toEqual([
      { t: 'setDefenseLine', armyId: view.armies[0]?.id, points: scenario.hexes },
    ]);
    expect(scenario.hexes.length).toBeGreaterThanOrEqual(3);
    expect(
      scenario.hexes.every(
        (point, index) =>
          index === 0 ||
          neighbors(hexFromId(scenario.hexes[index - 1] as number, map.width)).some(
            (hex) => hexId(hex, map.width) === point,
          ),
      ),
    ).toBe(true);
  });

  it('не отправляет линию обороны через недопустимый участок', async () => {
    const { map, view, world } = await renderSurface();
    await selectArmy();
    await chooseTool(/Оборона|Defense/);
    const scenario = findBlockedLineScenario(map, view);
    const originalOwner = view.hexes.owner[scenario.last];
    view.hexes.owner[scenario.last] = view.playerId;
    expect(
      defenseLinePath({ map, hexes: view.hexes }, view.playerId, [scenario.first, scenario.last]),
    ).toBe(null);
    stroke([...scenario.points, scenario.points[0] as { x: number; y: number }], world);
    view.hexes.owner[scenario.last] = originalOwner as number;
    expect(harness.commands).toEqual([
      { t: 'setDefenseLine', armyId: view.armies[0]?.id, points: [scenario.first, 4477, 4478] },
    ]);
    expect(harness.commands[0]).not.toEqual({
      t: 'setDefenseLine',
      armyId: view.armies[0]?.id,
      points: [scenario.first, 4477, 4478, scenario.last],
    });
  });

  it('не создаёт мост через запрет во фронте и отменяет непустой жест без send', async () => {
    const { view, world } = await renderSurface();
    await selectArmy();
    await chooseTool(/Фронт|Front/);
    const scenario = blockedFrontScenario();
    stroke(scenario.points, world);
    const frontCommand = harness.commands[0];
    if (frontCommand?.t !== 'assignFront') throw new Error('Ожидался приказ фронта');
    expect(frontCommand.edges).toEqual(scenario.prefix);
    expect(frontCommand.edges).not.toContain(scenario.suffix);
    expect(harness.commands[0]).not.toEqual({
      t: 'assignFront',
      armyId: view.armies[0]?.id,
      edges: [scenario.prefix[0], scenario.suffix],
    });

    harness.commands = [];
    await chooseTool(/Фронт|Front/);
    stroke([scenario.points[0], scenario.points[1]], world, true);
    expect(harness.commands).toEqual([]);
  });

  it('захватывает свою фишку и отправляет split после вытягивания через MatchSurfaceRuntime', async () => {
    const { map, view, world } = await renderSurface();
    const unit = view.units.find(
      (item) =>
        item.owner === view.playerId &&
        item.order !== 'retreat' &&
        item.moveTotal === 0 &&
        map.terrain[item.hex] !== TERRAIN.water,
    );
    if (!unit || !harness.canvas) throw new Error('Не найден подходящий собственный отряд');
    (unit as { soldiers: number }).soldiers = 200 * FP;
    const center = hexCenter(hexFromId(unit.hex, map.width), radius);
    const city = view.cities.find((item) => item.hex === unit.hex);
    const point = world.toGlobal({
      x: center.x,
      y: center.y + (city ? cityChipShift(city.level, radius) : 0),
    });
    const total = Math.floor(unit.soldiers / FP);
    const amount = Math.max(50, Math.min(total - 50, Math.round((total * 0.5) / 50) * 50));
    expect(view.units.some((item) => item.id === unit.id && item.owner === view.playerId)).toBe(
      true,
    );
    expect(harness.commands).toEqual([]);

    fireEvent.pointerDown(harness.canvas, {
      button: 0,
      pointerId: 41,
      pointerType: 'mouse',
      clientX: point.x,
      clientY: point.y,
    });
    fireEvent.pointerMove(harness.canvas, {
      pointerId: 41,
      clientX: point.x + 12,
      clientY: point.y,
    });
    fireEvent.pointerUp(harness.canvas, {
      pointerId: 41,
      clientX: point.x + 12,
      clientY: point.y,
    });

    expect(harness.commands).toEqual([{ t: 'split', unitId: unit.id, soldiers: amount * FP }]);
  });
});
