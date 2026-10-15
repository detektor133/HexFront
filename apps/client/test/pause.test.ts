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
      useLayoutEffect: (effect: () => void) => effect(),
      useMemo: <T>(factory: () => T) => factory(),
      useRef: <T>(value: T) => ({ current: value }),
      useState: <T>(value: T) => {
        const index = cursor;
        cursor += 1;
        if (!(index in states)) {
          states[index] = typeof value === 'function' ? (value as () => T)() : value;
        }
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

function findNodeByIcon(node: unknown): ElementNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const element = node as ElementNode;
  if (typeof element.type === 'function' && element.type.name === 'PlayerPauseIcon') {
    const component = element.type as (props: Record<string, unknown>) => unknown;
    return findNodeByIcon(component(element.props ?? {}));
  }
  if (
    element.type === 'svg' &&
    element.props?.viewBox === '0 0 24 24' &&
    (element.props.children as readonly ElementNode[] | undefined)?.some(
      (child) => child.props?.d === 'M6 5v14',
    )
  )
    return element;
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findNodeByIcon(child);
      if (found) return found;
    }
  }
  return findNodeByIcon(children);
}

function findPauseButton(node: unknown): ElementNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const element = node as ElementNode;
  if (typeof element.type === 'function' && element.type.name === 'Hud') {
    const component = element.type as (props: Record<string, unknown>) => unknown;
    return findPauseButton(component(element.props ?? {}));
  }
  if (element.type === 'button' && findNodeByIcon(element.props?.children)) return element;
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findPauseButton(child);
      if (found) return found;
    }
  }
  return findPauseButton(children);
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
    setBrowser('?map=gen&seed=73&players=30');
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
    expect(setPaused).toHaveBeenLastCalledWith(false);
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const resumedTree = MatchSurface({});
    expect(findNode(resumedTree, 'PauseMenu')).toBeUndefined();

    const resumedHud = findNode(resumedTree, 'Hud');
    (resumedHud?.props?.onPause as (() => void) | undefined)?.();
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const pausedAgainTree = MatchSurface({});
    const menuAgain = findNode(pausedAgainTree, 'PauseMenu');
    expect(menuAgain).toBeDefined();
    const pauseAgainMarkup = PauseMenu(menuAgain?.props as never);
    const menuAgainButtons = (pauseAgainMarkup.props.children as unknown as ElementNode[]).slice(1);
    (menuAgainButtons[2]?.props?.onClick as (() => void) | undefined)?.();
    expect(window.location.assign).toHaveBeenCalledWith('/');
  });

  it('рендерит PauseMenu и вызывает обработчики его кнопок', async () => {
    const setPaused = vi.fn();
    mockReactHooks();
    mockRuntime(setPaused);
    setBrowser('?map=gen&seed=73&players=30');
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
    expect(setPaused).toHaveBeenCalledWith(false);
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const resumedTree = MatchSurface({});
    expect(findNode(resumedTree, 'PauseMenu')).toBeUndefined();

    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const resumedHud = findNode(resumedTree, 'Hud');
    (resumedHud?.props?.onPause as (() => void) | undefined)?.();
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const pausedAgainTree = MatchSurface({});
    const pausedAgainMenu = findNode(pausedAgainTree, 'PauseMenu');
    expect(pausedAgainMenu).toBeDefined();
    const pausedAgain = (pausedAgainMenu?.type as (props: Record<string, unknown>) => ElementNode)(
      pausedAgainMenu?.props ?? {},
    );
    const pausedAgainButtons = (pausedAgain.props?.children as unknown as ElementNode[]).slice(1);
    (pausedAgainButtons[1]?.props?.onClick as (() => void) | undefined)?.();
    expect(window.location.assign).toHaveBeenCalledWith('/match?map=gen&seed=73&players=30');

    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const pausedThirdTree = MatchSurface({});
    const pausedThirdMenu = findNode(pausedThirdTree, 'PauseMenu');
    expect(pausedThirdMenu).toBeDefined();
    const pausedThird = (pausedThirdMenu?.type as (props: Record<string, unknown>) => ElementNode)(
      pausedThirdMenu?.props ?? {},
    );
    const pausedThirdButtons = (pausedThird.props?.children as unknown as ElementNode[]).slice(1);
    (pausedThirdButtons[2]?.props?.onClick as (() => void) | undefined)?.();
    expect(window.location.assign).toHaveBeenCalledWith('/');
  });

  it('visibilitychange hidden вызывает паузу через обработчик MatchSurface', async () => {
    const setPaused = vi.fn();
    mockReactHooks();
    mockRuntime(setPaused);
    setBrowser('?map=gen&seed=73&players=30');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    MatchSurface({});
    const listeners = (globalThis as unknown as { __pauseListeners: Map<string, () => void> })
      .__pauseListeners;
    Object.assign(document, { visibilityState: 'hidden' });
    listeners.get('visibilitychange')?.();
    expect(setPaused).toHaveBeenCalledWith(true);
    (globalThis as unknown as { __resetPauseHooks: () => void }).__resetPauseHooks();
    const pausedTree = MatchSurface({});
    expect(findNode(pausedTree, 'PauseMenu')).toBeDefined();
    expect(setPaused).toHaveBeenLastCalledWith(true);
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
    mockRuntime(vi.fn(), true);
    setBrowser('?map=gen&seed=73&players=30');
    setLanguage('ru-RU');
    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const tree = MatchSurface({});
    const markup = renderToStaticMarkup(createElement(MatchSurface));
    expect(markup).not.toContain('1×');
    expect(markup).not.toContain('5×');
    expect(markup).not.toContain('20×');
    expect(findNode(tree, 'ObserverPanel')).toBeUndefined();
    const pauseButton = findPauseButton(tree);
    expect(pauseButton).toBeDefined();
    expect(pauseButton?.props?.['aria-label']).toBe('Пауза');
    const pauseIcon = findNodeByIcon(pauseButton?.props?.children);
    expect(pauseIcon?.props?.viewBox).toBe('0 0 24 24');
    expect(
      (pauseIcon?.props?.children as readonly ElementNode[]).map((path) => path.props?.d),
    ).toEqual(['M6 5v14', 'M10 5v14', 'M14 5v14', 'M18 5v14']);
    expect(readFileSync(new URL('../src/dev/Hud.module.css', import.meta.url), 'utf8')).toMatch(
      /\.settingsButton\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
    expect(readFileSync(new URL('../src/dev/Hud.module.css', import.meta.url), 'utf8')).toMatch(
      /\.settingsIcon\s*\{[^}]*stroke-width:\s*1\.75;[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;/s,
    );
  });
});
