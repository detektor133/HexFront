import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import type * as ReactTypes from 'react';
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
const map = loaded.map;
const localEngine = engine;

type ElementNode = {
  readonly type?: { readonly name?: string } | string;
  readonly props?: Record<string, unknown>;
};

function setBrowser(search: string): void {
  const listeners = new Map<string, () => void>();
  Object.assign(globalThis, {
    window: {
      location: { search, pathname: '/match', assign: vi.fn(), reload: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    },
    document: {
      visibilityState: 'visible',
      addEventListener: vi.fn((name: string, listener: () => void) =>
        listeners.set(name, listener),
      ),
      removeEventListener: vi.fn(),
    },
    __pauseListeners: listeners,
  });
}

function setLanguage(language: string): void {
  vi.stubGlobal('navigator', { language });
}

function mockReactHooks(): void {
  const states: unknown[] = [];
  let cursor = 0;
  Object.assign(globalThis, { __resetPauseHooks: () => (cursor = 0) });
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof ReactTypes>('react');
    return {
      ...actual,
      useEffect: (effect: () => void) => effect(),
      useMemo: <T>(factory: () => T) => factory(),
      useRef: <T>(value: T) => ({ current: value }),
      useState: <T>(value: T) => {
        const index = cursor;
        cursor += 1;
        if (!(index in states)) states[index] = value;
        const setValue = (next: T | ((current: T) => T)): void => {
          states[index] =
            typeof next === 'function' ? (next as (current: T) => T)(states[index] as T) : next;
        };
        return [states[index] as T, setValue] as const;
      },
    };
  });
}

function findNode(node: unknown, name: string): ElementNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const element = node as ElementNode;
  if (
    (typeof element.type === 'function' || typeof element.type === 'object') &&
    element.type?.name === name
  )
    return element;
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findNode(child, name);
      if (found) return found;
    }
  }
  return findNode(children, name);
}

function mockRuntime(
  setPaused: () => void,
  withView: boolean = true,
  winner: number | undefined = undefined,
): void {
  const snapshot = localEngine.snapshot();
  const view = winner === undefined ? snapshot.view : { ...snapshot.view, winner };
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMap, map }),
    useSandbox: () => ({
      msg: withView ? { ...snapshot, view } : null,
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
      setPaused,
      snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
      cacheTelemetry: () => ({
        unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
        economy: { capturesByHex: 0, cityFlashes: 0 },
        frontTween: { byArmy: 0 },
      }),
      focusEvent: vi.fn(),
      send: vi.fn(),
      setFog: vi.fn(),
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

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('пауза локального матча', () => {
  it('проводит кнопку HUD через MatchSurface и останавливает worker', async () => {
    const setPaused = vi.fn();
    mockReactHooks();
    mockRuntime(setPaused);
    setBrowser('');
    setLanguage('ru-RU');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const tree = MatchSurface({});
    const hud = findNode(tree, 'Hud');
    expect(hud?.props?.onPause).toEqual(expect.any(Function));

    (hud?.props?.onPause as (() => void) | undefined)?.();

    expect(setPaused).toHaveBeenCalledWith(true);
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const pausedTree = MatchSurface({});
    const pauseMenu = findNode(pausedTree, 'PauseMenu');
    expect(pauseMenu).toBeDefined();
    const { PauseMenu } = await import('../src/match/PauseMenu.tsx');
    const pauseMarkup = PauseMenu(pauseMenu?.props as never);
    expect(renderToStaticMarkup(pauseMarkup)).toContain('Продолжить');
    const pauseButtons = (pauseMarkup.props.children as unknown as ElementNode[]).slice(1);
    (pauseButtons[0]?.props?.onClick as (() => void) | undefined)?.();
    (pauseButtons[1]?.props?.onClick as (() => void) | undefined)?.();
    (pauseButtons[2]?.props?.onClick as (() => void) | undefined)?.();
    expect(window.location.reload).toHaveBeenCalledOnce();
    expect(window.location.assign).toHaveBeenCalledWith('/');
    const { Hud } = await import('../src/dev/Hud.tsx');
    expect(renderToStaticMarkup(Hud(hud?.props as never))).toContain('player-pause');
  });

  it('рендерит PauseMenu и вызывает обработчики его кнопок', async () => {
    mockReactHooks();
    mockRuntime(vi.fn());
    setBrowser('');
    setLanguage('ru-RU');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const initialTree = MatchSurface({});
    const hud = findNode(initialTree, 'Hud');
    (hud?.props?.onPause as (() => void) | undefined)?.();
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const tree = MatchSurface({});
    const menu = findNode(tree, 'PauseMenu');
    expect(menu).toBeDefined();
    const pauseMenu = (menu?.type as (props: Record<string, unknown>) => ElementNode)(
      menu?.props ?? {},
    );
    const markup = renderToStaticMarkup(
      createElement(menu?.type as ReactTypes.ElementType, menu?.props),
    );
    expect(markup).toContain('Продолжить');
    expect(markup).toContain('Заново');
    expect(markup).toContain('В меню');
    const menuButtons = (pauseMenu.props?.children as unknown as ElementNode[]).slice(1);
    (menuButtons[0]?.props?.onClick as (() => void) | undefined)?.();
    (menuButtons[1]?.props?.onClick as (() => void) | undefined)?.();
  });

  it('visibilitychange hidden вызывает паузу через обработчик MatchSurface', async () => {
    const setPaused = vi.fn();
    mockReactHooks();
    mockRuntime(setPaused, false);
    setBrowser('');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    MatchSurface({});
    const listeners = (globalThis as unknown as { __pauseListeners: Map<string, () => void> })
      .__pauseListeners;
    Object.assign(document, { visibilityState: 'hidden' });
    listeners.get('visibilitychange')?.();
    expect(setPaused).toHaveBeenCalledWith(true);
  });

  it('кнопка «В меню» на MatchEnd вызывает переход на корень', async () => {
    mockReactHooks();
    mockRuntime(vi.fn(), true, 0);
    setBrowser('');
    setLanguage('ru-RU');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const tree = MatchSurface({});
    const matchEnd = findNode(tree, 'MatchEnd');
    expect(matchEnd).toBeDefined();
    const markup = renderToStaticMarkup(
      createElement(matchEnd?.type as ReactTypes.ElementType, matchEnd?.props),
    );
    expect(markup).toContain('В меню');
    const end = (matchEnd?.type as (props: Record<string, unknown>) => ElementNode)(
      matchEnd?.props ?? {},
    );
    const endButtons = (end?.props?.children as unknown as ElementNode[]).filter(
      (child) => child?.type === 'button',
    );
    (endButtons.at(-1)?.props?.onClick as (() => void) | undefined)?.();
    expect(window.location.assign).toHaveBeenCalledWith('/');
  });

  it('/match без debug не показывает выбор скорости', async () => {
    mockReactHooks();
    mockRuntime(vi.fn(), false);
    setBrowser('');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(createElement(MatchSurface));
    expect(markup).not.toContain('1×');
    expect(markup).not.toContain('5×');
    expect(markup).not.toContain('20×');
  });
});
