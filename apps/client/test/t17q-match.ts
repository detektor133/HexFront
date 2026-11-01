import { vi } from 'vitest';

import type { MapStatic } from '@hexfront/sim';

import type { LocalEngine } from '../src/local/engine.ts';
import type { LocalMatch } from '../src/local/local-match.ts';
import type { FromWorker } from '../src/local/messages.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import type { MapView, MapViewOptions, MapViewState, TapKind } from '../src/render/map-view.ts';

type ChipBounds = (unitId: number) => {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} | null;

export function installMatchMocks(
  engine: LocalEngine,
  matchMap: unknown,
): {
  getTap: () => ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
  getSelection: () =>
    ((from: Point, to: Point, phase: 'start' | 'move' | 'end') => void) | undefined;
  getChipBounds: () => ChipBounds | undefined;
  emit: () => void;
} {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => matchMap,
    })),
  );
  let tap: ((hex: { q: number; r: number }, kind: TapKind, world: Point) => void) | undefined;
  let selection: ((from: Point, to: Point, phase: 'start' | 'move' | 'end') => void) | undefined;
  let chipBounds: ChipBounds | undefined;
  let onMessage: ((message: FromWorker) => void) | undefined;
  const emit = (): void => onMessage?.(engine.snapshot());

  vi.doMock('../src/local/local-match.ts', () => ({
    startLocalMatch: (
      _map: unknown,
      _seed: number,
      _setup: unknown,
      messageHandler: (message: FromWorker) => void,
    ): LocalMatch => {
      onMessage = messageHandler;
      emit();
      return {
        send: vi.fn(),
        setFog: vi.fn(),
        setPaused: vi.fn(),
        step: vi.fn(),
        setSpeed: vi.fn(),
        setObserver: vi.fn(),
        setView: vi.fn(),
        select: (hex) => {
          engine.select(hex);
          emit();
        },
        ack: vi.fn(),
        dispose: vi.fn(),
      };
    },
  }));
  vi.doMock('../src/render/map-view.ts', () => ({
    createMapView: async (
      _host: HTMLElement,
      map: MapStatic,
      options: MapViewOptions,
      _onState: (state: MapViewState) => void,
      onTap?: (hex: { q: number; r: number }, kind: TapKind, world: Point) => void,
    ): Promise<MapView> => {
      const layer = options.midLayer?.(map, options.radius) as
        { readonly chipBounds?: ChipBounds } | undefined;
      chipBounds = layer?.chipBounds;
      tap = onTap;
      return {
        configure: vi.fn(),
        setScale: vi.fn(),
        setBottomInset: vi.fn(),
        setTopInset: vi.fn(),
        centerOn: vi.fn(),
        setStroke: vi.fn(),
        setSelection: (onSelection) => {
          selection = onSelection ?? undefined;
        },
        setGrab: vi.fn(),
        setOrderHooks: vi.fn(),
        cancel: vi.fn(),
        sceneStats: () => ({
          objects: 0,
          text: 0,
          graphics: 0,
          graphicsInstructions: [],
          graphicsDetails: [],
          textures: 0,
          canvasTextTextures: null,
        }),
        destroy: vi.fn(),
      };
    },
  }));
  return {
    getTap: () => tap,
    getSelection: () => selection,
    getChipBounds: () => chipBounds,
    emit,
  };
}
