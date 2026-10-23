import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbors,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { applyStartCamera as applyStartCameraToMap } from './start-camera.ts';
import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { appendEvents, type EventFeedItem } from '../dev/event-feed.ts';
import { createOrderHooks } from '../dev/order-hooks.ts';
import type { Draft, DraftContext } from '../dev/plan-draft.ts';
import { createPlanInput, type ToolState } from '../dev/plan-tools.ts';
import { buildRadialActions, type RadialAction, type RadialMenuState } from '../dev/radial-menu.ts';
import { sandboxMapUrl, type SandboxMapRequest } from '../dev/sandbox-map.ts';
import {
  armySelection,
  NOTHING_PICKED,
  orderHex,
  selectHex,
  selectUnits,
  selectUnitsInRect,
  type Picked,
} from '../dev/sandbox-selection.ts';
import { createSplitGrab } from '../dev/split-drag.ts';
import {
  createSnapshotTelemetry,
  type CacheTelemetry,
  type PixiTelemetry,
  type SnapshotTelemetry,
  type SnapshotTelemetryCounts,
  type WorkerTelemetry,
} from '../dev/telemetry.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import { readLocalMatchSetup } from '../local/match-setup.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { hexCenter, type Point } from '../render/hex-geometry.ts';
import { createMapView, type MapView, type RadialHooks, type TapKind } from '../render/map-view.ts';
import { playerColorIds, setPlayerPalette } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

export type Loaded = { json: unknown; map: MapStatic } | 'loading' | 'error';

export function useMapJson(request: SandboxMapRequest): Loaded {
  const [state, setState] = useState<Loaded>('loading');
  useEffect(() => {
    let alive = true;
    fetch(sandboxMapUrl(request))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: unknown) => {
        const result = loadMap(json);
        if (!result.ok) throw new Error(result.errors.join('; '));
        if (alive) setState({ json, map: result.map });
      })
      .catch((error: unknown) => {
        console.error('dev_sandbox_map_failed', error);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [request]);
  return state;
}

type WorkerViewMessage = Extract<FromWorker, { t: 'view' }>;
type ViewMessage = WorkerViewMessage & { readonly view: PlayerView };
export type RadialPhase = 'start' | 'move' | 'end' | 'cancel';

export function createRadialActionHandler(options: {
  getView: () => PlayerView | null;
  send: (command: Command) => void;
  getState: () => RadialMenuState | null;
  setState: (state: RadialMenuState | null) => void;
}): (armyId: number | null, screen: Point, phase: RadialPhase) => void {
  return (armyId, screen, phase): void => {
    const view = options.getView();
    if (!view) return;
    if (phase === 'start') {
      const actions = buildRadialActions(
        view.units.filter((unit) => unit.owner === view.playerId && unit.armyId === armyId),
        view,
      );
      options.setState({ center: screen, actions, active: actions });
      return;
    }
    // После открытия жест передан DOM-меню: отпускание указателя не выбирает сектор.
    if (phase === 'cancel') options.setState(null);
  };
}

export function focusUnitOnDoubleTap(options: {
  view: PlayerView;
  map: MapStatic;
  hex: { readonly q: number; readonly r: number };
  picked: Picked;
  hit: readonly number[];
  pick: (picked: Picked) => void;
  centerOn: (hex: { readonly q: number; readonly r: number }, durationMs: number) => void;
}): void {
  const { view, map, hit } = options;
  if (hit.length === 0) return;
  const next = selectUnits(view, options.picked, hit);
  options.pick(next);
  const unit = view.units.find((candidate) => hit.includes(candidate.id));
  options.centerOn(
    hexFromId(unit?.hex ?? hexId(options.hex, map.width), map.width),
    tokens.motion.map,
  );
}

export function createDoubleTapHandler(options: {
  getView: () => PlayerView | null;
  map: MapStatic;
  getPicked: () => Picked;
  getHit: (world: Point) => readonly number[];
  pick: (picked: Picked) => void;
  centerOn: (hex: { readonly q: number; readonly r: number }, durationMs: number) => void;
}): (hex: { readonly q: number; readonly r: number }, world: Point) => void {
  return (hex, world): void => {
    const view = options.getView();
    if (!view || !inBounds(hex, options.map.width, options.map.height)) return;
    const hit = options.getHit(world);
    if (hit.length === 0) return;
    focusUnitOnDoubleTap({
      view,
      map: options.map,
      hex,
      picked: options.getPicked(),
      hit,
      pick: options.pick,
      centerOn: options.centerOn,
    });
  };
}

export function createOrderHandler(options: {
  getView: () => PlayerView | null;
  getPicked: () => Picked;
  send: (command: Command) => void;
  pick: (picked: Picked) => void;
}): (hex: number) => void {
  return (hex): void => {
    const view = options.getView();
    if (!view) return;
    const next = orderHex(view, options.getPicked(), hex);
    if (next.cmd) options.send(next.cmd);
    options.pick(next.picked);
  };
}
type PlayerColorId = (typeof tokens.players.palette)[number]['id'];

const NICKNAME_KEY = 'hexfront.nickname';
const COLOR_KEY = 'hexfront.color';
const AUTO_COMMAND_KEY = 'hexfront.auto-command';

function matchPlayerColors(selected: string): readonly PlayerColorId[] {
  return playerColorIds(selected) as readonly PlayerColorId[];
}

interface Sandbox {
  readonly msg: ViewMessage | null;
  readonly replay: readonly PlayerView[];
  readonly error: string | null;
  readonly picked: Picked;
  readonly lastReject: string | null;
  readonly tool: ToolState | null;
  readonly army: number | null;
  readonly fog: boolean;
  readonly paused: boolean;
  readonly speed: number;
  readonly observerId: number | null;
  readonly events: readonly EventFeedItem[];
  readonly workerTelemetry: WorkerTelemetry | null;
  snapshotTelemetry(): SnapshotTelemetryCounts;
  cacheTelemetry(): CacheTelemetry;
  focusEvent(item: EventFeedItem): void;
  send(cmd: Command): void;
  setFog(on: boolean): void;
  setPaused(on: boolean): void;
  step(): void;
  setSpeed(value: number): void;
  setObserver(playerId: number | null): void;
  pick(p: Picked): void;
  setTool(t: ToolState | null): void;
  setArmy(id: number | null): void;
  setRoadPreview(path: readonly number[] | null): void;
  setDockHeight(height: number, leaderboardWidth?: number): void;
  setHudHeight(height: number, leaderboardWidth?: number): void;
  pixiTelemetry(): PixiTelemetry;
  readonly radial: RadialMenuState | null;
  radialForArmy(armyId: number | null, screen: Point, phase: RadialPhase): void;
  radialAction(action: RadialAction): void;
}

/** Локальный матч + карта: Web Worker, сцена Pixi, выбор и приказы кликом. */
export function useSandbox(
  hostRef: React.RefObject<HTMLDivElement | null>,
  loaded: Loaded,
  mapRequest: SandboxMapRequest,
  debug: boolean,
): Sandbox {
  const matchRef = useRef<LocalMatch | null>(null);
  const layerRef = useRef<EconomyLayer | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const pickedRef = useRef<Picked>(NOTHING_PICKED);
  const mapViewRef = useRef<MapView | null>(null);
  const toolRef = useRef<ToolState | null>(null);
  const armyRef = useRef<number | null>(null);
  const radialArmyRef = useRef<number | null>(null);
  const [tool, setToolState] = useState<ToolState | null>(null);
  const [army, setArmyState] = useState<number | null>(null);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [replay, setReplay] = useState<readonly PlayerView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const [lastReject, setLastReject] = useState<string | null>(null);
  const [fog, setFogState] = useState(true);
  const [paused, setPausedState] = useState(
    readLocalMatchSetup(window.location.search).speed === 0,
  );
  const [speed, setSpeedState] = useState(
    Math.max(1, readLocalMatchSetup(window.location.search).speed),
  );
  const [observerId, setObserverId] = useState<number | null>(null);
  const [events, setEvents] = useState<readonly EventFeedItem[]>([]);
  const [radial, setRadial] = useState<RadialMenuState | null>(null);
  const radialRef = useRef<RadialMenuState | null>(null);
  const eventsRef = useRef<readonly EventFeedItem[]>([]);
  const dockHeightRef = useRef(0);
  const hudHeightRef = useRef(0);
  const rightInsetRef = useRef(0);
  const observerIdRef = useRef<number | null>(null);
  const workerTelemetryRef = useRef<WorkerTelemetry | null>(null);
  const snapshotTelemetryRef = useRef<SnapshotTelemetry | null>(null);
  if (snapshotTelemetryRef.current === null) {
    snapshotTelemetryRef.current = createSnapshotTelemetry();
  }

  const pick = useCallback((p: Picked) => {
    if (p.hex !== pickedRef.current.hex) matchRef.current?.select(p.hex);
    pickedRef.current = p;
    setPicked(p);
    // Подсвечивается что-то одно: выбраны все отряды армии — армия выбрана сама; выбран гекс —
    // армия не выбрана (07-controls.md, «Что выбрано»).
    const v = viewRef.current;
    if (v && p.units.length > 0) setArmyRef.current(armySelection(v, p.units).whole);
    else if (p.hex !== null) setArmyRef.current(null);
    layerRef.current?.setRoadPreview(null);
    if (v) layerRef.current?.setView(v, p);
  }, []);
  const send = useCallback((cmd: Command) => matchRef.current?.send(cmd), []);
  const setFog = useCallback((on: boolean) => {
    matchRef.current?.setView(observerIdRef.current, on);
    setFogState(on);
  }, []);
  const setPaused = useCallback((on: boolean) => {
    matchRef.current?.setPaused(on);
    setPausedState(on);
  }, []);
  const step = useCallback(() => matchRef.current?.step(), []);
  const setSpeed = useCallback((value: number) => {
    matchRef.current?.setSpeed(value);
    setSpeedState(value);
    setPausedState(false);
  }, []);
  const setObserver = useCallback((playerId: number | null) => {
    matchRef.current?.setView(playerId, playerId !== null);
    observerIdRef.current = playerId;
    setObserverId(playerId);
    setFogState(playerId !== null);
  }, []);
  const setArmy = useCallback((id: number | null) => {
    armyRef.current = id;
    setArmyState(id);
    layerRef.current?.setSelectedArmy(id);
  }, []);
  const setRoadPreview = useCallback((path: readonly number[] | null) => {
    layerRef.current?.setRoadPreview(path);
  }, []);
  const setArmyRef = useRef(setArmy);
  const setRadialState = useCallback((next: RadialMenuState | null): void => {
    radialRef.current = next;
    setRadial(next);
  }, []);
  const radialForArmy = useCallback(
    createRadialActionHandler({
      getView: () => viewRef.current,
      send: (command) => matchRef.current?.send(command),
      getState: () => radialRef.current,
      setState: setRadialState,
    }),
    [],
  );
  const radialAction = useCallback(
    (action: RadialAction): void => {
      const state = radialRef.current;
      if (!state) return;
      if (action.children) {
        setRadialState({ ...state, active: action.children });
        return;
      }
      if (action.command) matchRef.current?.send(action.command);
      setRadialState(null);
    },
    [setRadialState],
  );
  // setTool зависит от input, а input вызывает setTool — связь через ссылку.
  const splitGrab = useMemo(
    () =>
      createSplitGrab({
        context: (): DraftContext | null => {
          const v = viewRef.current;
          if (!v || typeof loaded === 'string') return null;
          return { map: loaded.map, view: v, radius: tokens.map.hexRadius };
        },
        chipAt: (hex) => layerRef.current?.chipAt(hex) ?? { x: 0, y: 0 },
        send: (cmd) => matchRef.current?.send(cmd),
        setOverlay: (o) => layerRef.current?.setSplit(o),
      }),
    [loaded],
  );
  const setToolRef = useRef<(t: ToolState | null) => void>(() => undefined);
  // Инструменты планов: рисование пальцем по граням, тапы, ручки фронта (CR-004).
  const input = useMemo(
    () =>
      createPlanInput({
        context: (): DraftContext | null => {
          const v = viewRef.current;
          if (!v || typeof loaded === 'string') return null;
          return { map: loaded.map, view: v, radius: tokens.map.hexRadius };
        },
        tool: () => toolRef.current,
        selected: () => armyRef.current,
        setTool: (t) => setToolRef.current(t),
        setDraft: (d: Draft | null) => layerRef.current?.setDraft(d),
        send: (cmd) => matchRef.current?.send(cmd),
      }),
    [loaded],
  );
  const setTool = useCallback(
    (t: ToolState | null) => {
      toolRef.current = t;
      setToolState(t);
      layerRef.current?.setDraft(null);
      // «Удалить» работает тапом, карту при нём можно двигать; остальные — рисуют пальцем.
      mapViewRef.current?.setStroke(t && t.tool !== 'erase' ? input.stroke : null);
    },
    [input],
  );
  setToolRef.current = setTool;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof loaded === 'string') return;
    const { map, json } = loaded;
    let view: MapView | null = null;
    let cancelled = false;
    let pendingMessage: WorkerViewMessage | null = null;
    let frameRequest = 0;
    let appliedMessage = false;
    let startCameraApplied = false;
    const deltaApplier = new ViewDeltaApplier();
    const setup = readLocalMatchSetup(window.location.search);
    const applyStartCameraToView = (currentView: PlayerView): void => {
      if (startCameraApplied || !mapViewRef.current) return;
      const city = currentView.cities.find((item) => item.owner === currentView.playerId);
      if (!city) return;
      startCameraApplied = true;
      const playerCity = hexFromId(city.hex, map.width);
      applyStartCameraToMap({
        mapView: mapViewRef.current,
        playerCity,
        playerUnitHexes: currentView.units
          .filter((unit) => unit.owner === currentView.playerId)
          .map((unit) => hexFromId(unit.hex, map.width)),
        nearbyHexes: neighbors(playerCity),
      });
    };
    const applyMessage = (m: WorkerViewMessage): void => {
      const view =
        m.kind === 'snapshot'
          ? deltaApplier.applySnapshot(m.snapshot)
          : deltaApplier.applyDelta(m.delta);
      const applied = { ...m, view } as ViewMessage;
      if (view.tick % 10 === 0 || view.winner >= 0) {
        setReplay((current) => {
          if (current.at(-1)?.tick === view.tick) return current;
          return [...current, view].slice(-151);
        });
      }
      snapshotTelemetryRef.current?.track(applied);
      viewRef.current = view;
      applyStartCameraToView(view);
      workerTelemetryRef.current = m.telemetry ?? null;
      layerRef.current?.setView(view, pickedRef.current);
      setMsg(applied);
      const nextEvents = appendEvents(eventsRef.current, m.events, view, performance.now());
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      const last = m.rejected.at(-1);
      if (last) setLastReject(reasonText(last.reason));
      matchRef.current?.ack(m.seq);
    };
    const scheduleMessage = (m: WorkerViewMessage): void => {
      if (!appliedMessage && layerRef.current) {
        appliedMessage = true;
        applyMessage(m);
        return;
      }
      pendingMessage = m;
      if (frameRequest !== 0) return;
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        const next = pendingMessage;
        pendingMessage = null;
        if (!next || cancelled) return;
        appliedMessage = true;
        applyMessage(next);
      });
    };
    const match = startLocalMatch(
      json,
      mapRequest.seed,
      readLocalMatchSetup(window.location.search),
      (m) => {
        if (m.t === 'error') return setError(m.errors.join('; '));
        scheduleMessage(m);
      },
      {
        telemetry: debug,
        playerName:
          setup.playerName ?? localStorage.getItem(NICKNAME_KEY) ?? `${t('observer.player')} 1`,
        playerColors: matchPlayerColors(
          setup.playerColor ?? localStorage.getItem(COLOR_KEY) ?? 'teal',
        ),
        autoCommand: setup.autoCommand ?? localStorage.getItem(AUTO_COMMAND_KEY) === 'true',
      },
    );
    setPlayerPalette(
      matchPlayerColors(setup.playerColor ?? localStorage.getItem(COLOR_KEY) ?? 'teal'),
    );
    matchRef.current = match;
    match.setView(null, !debug);
    setFogState(!debug);
    // Параметры для скриншотов и отладки: сразу выбранный гекс и масштаб.
    const params = new URLSearchParams(window.location.search);
    const initialSelect = params.get('select');
    if (initialSelect !== null) pick({ hex: Number(initialSelect), units: [], target: null });
    const initialScale = Number(params.get('scale'));
    const onTap = (h: { q: number; r: number }, kind: TapKind, world: Point): void => {
      const current = viewRef.current;
      if (!current || !inBounds(h, map.width, map.height)) {
        return toolRef.current ? undefined : pick(NOTHING_PICKED);
      }
      const hex = hexId(h, map.width);
      if (input.tap(world, kind) || input.onHandle(world)) return;
      if (kind === 'select') {
        const hit = layerRef.current?.unitsAt(world) ?? [];
        return pick(
          hit.length > 0
            ? selectUnits(current, pickedRef.current, hit)
            : selectHex(current, pickedRef.current, hex),
        );
      }
      order(hex);
    };
    const onDoubleTap = createDoubleTapHandler({
      getView: () => viewRef.current,
      map,
      getPicked: () => pickedRef.current,
      getHit: (world) => layerRef.current?.unitsAt(world) ?? [],
      pick,
      centerOn: (hex, durationMs) => mapViewRef.current?.centerOn(hex, durationMs),
    });
    // Приказ (ПКМ, отпущенное удержание): «идти» или «атаковать» сразу, без подтверждения.
    const order = createOrderHandler({
      getView: () => viewRef.current,
      getPicked: () => pickedRef.current,
      send: (command) => match.send(command),
      pick,
    });
    const hooks = createOrderHooks({
      map,
      radius: tokens.map.hexRadius,
      view: () => viewRef.current,
      picked: () => pickedRef.current,
      tool: () => toolRef.current !== null,
      chipAt: (hex) => layerRef.current?.chipAt(hex) ?? { x: 0, y: 0 },
      setTarget: (t) => layerRef.current?.setOrderTarget(t),
      setPlanHover: (world) => layerRef.current?.setPlanHover(world),
      order,
    });
    const options = {
      radius: tokens.map.hexRadius,
      midLayer: (m: MapStatic, radius: number) => {
        const layer = createEconomyLayer(m, radius);
        layer.setSelectedArmy(armyRef.current);
        layerRef.current = layer;
        return layer;
      },
    };
    void createMapView(host, map, options, () => {}, onTap, onDoubleTap).then((v) => {
      if (cancelled) return v.destroy();
      view = v;
      mapViewRef.current = v;
      const currentTool = toolRef.current;
      v.setStroke(currentTool && currentTool.tool !== 'erase' ? input.stroke : null);
      if (viewRef.current) applyStartCameraToView(viewRef.current);
      v.setBottomInset(dockHeightRef.current);
      v.setTopInset(hudHeightRef.current);
      v.setTopInset(hudHeightRef.current, rightInsetRef.current);
      // Сначала ручки фронта выбранной армии, потом — вытягивание части из своей фишки.
      v.setGrab((world) => (toolRef.current ? null : (input.grab(world) ?? splitGrab(world))));
      v.setOrderHooks(hooks);
      const radialHooks: RadialHooks = {
        canOpen(world) {
          const current = viewRef.current;
          if (!current || toolRef.current) return false;
          const hit = layerRef.current?.unitsAt(world) ?? [];
          const unit = current.units.find((candidate) => {
            if (candidate.owner !== current.playerId || candidate.order === 'retreat') return false;
            return hit.includes(candidate.id);
          });
          if (!unit) return false;
          radialArmyRef.current = unit.armyId;
          if (!pickedRef.current.units.includes(unit.id))
            pick(selectUnits(current, pickedRef.current, [unit.id]));
          return true;
        },
        action(_world, screen, phase) {
          radialForArmy(radialArmyRef.current, screen, phase);
        },
      };
      v.setRadialHooks?.(radialHooks);
      v.setSelection((from, to, phase) => {
        if (phase !== 'end') return;
        const units = viewRef.current
          ? selectUnitsInRect(viewRef.current, from, to, (id) =>
              hexCenter(hexFromId(id, map.width), tokens.map.hexRadius),
            )
          : [];
        pick({ hex: null, units, target: null });
      });
      if (initialScale > 0) v.setScale(initialScale);
      const hex = pickedRef.current.hex;
      if (hex !== null) v.centerOn(hexFromId(hex, map.width));
      if (pendingMessage) {
        const next = pendingMessage;
        pendingMessage = null;
        appliedMessage = true;
        applyMessage(next);
      }
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) {
        const latest = eventsRef.current.at(-1);
        if (latest?.hex !== null && latest?.hex !== undefined) {
          e.preventDefault();
          mapViewRef.current?.centerOn(hexFromId(latest.hex, map.width));
        }
        return;
      }
      if (e.key !== 'Escape') return;
      mapViewRef.current?.cancel();
      if (toolRef.current) {
        input.cancel();
        setTool(null);
        return;
      }
      setRadialState(null);
      pick(NOTHING_PICKED);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      if (frameRequest !== 0) cancelAnimationFrame(frameRequest);
      window.removeEventListener('keydown', onKey);
      match.dispose();
      view?.destroy();
      matchRef.current = null;
      layerRef.current = null;
      mapViewRef.current = null;
      eventsRef.current = [];
      setRadialState(null);
    };
  }, [hostRef, loaded, mapRequest, pick, input, setTool, splitGrab, debug]);

  return {
    msg,
    replay,
    error,
    picked,
    lastReject,
    tool,
    army,
    send,
    fog,
    paused,
    speed,
    observerId,
    events,
    workerTelemetry: workerTelemetryRef.current,
    radial,
    radialForArmy,
    radialAction,
    snapshotTelemetry: () =>
      snapshotTelemetryRef.current?.counts() ?? { received: 0, collected: 0, live: 0 },
    focusEvent(item) {
      if (item.hex !== null && typeof loaded !== 'string') {
        mapViewRef.current?.centerOn(hexFromId(item.hex, loaded.map.width));
      }
    },
    setFog,
    setPaused,
    step,
    setSpeed,
    setObserver,
    pick,
    setTool,
    setArmy,
    setRoadPreview,
    setDockHeight(height, leaderboardWidth) {
      dockHeightRef.current = height;
      if (leaderboardWidth !== undefined)
        rightInsetRef.current = leaderboardWidth + tokens.space.xl;
      mapViewRef.current?.setBottomInset(height);
      if (leaderboardWidth !== undefined) {
        mapViewRef.current?.setTopInset(hudHeightRef.current, rightInsetRef.current);
      }
    },
    setHudHeight(height, leaderboardWidth) {
      hudHeightRef.current = height;
      if (leaderboardWidth !== undefined)
        rightInsetRef.current = leaderboardWidth + tokens.space.xl;
      mapViewRef.current?.setTopInset(height, rightInsetRef.current);
    },
    pixiTelemetry() {
      return (
        mapViewRef.current?.sceneStats() ?? {
          objects: 0,
          text: 0,
          graphics: 0,
          graphicsInstructions: [],
          graphicsDetails: [],
          textures: 0,
          canvasTextTextures: null,
        }
      );
    },
    cacheTelemetry() {
      const economy = layerRef.current?.cacheTelemetry();
      return {
        unit: economy ?? {
          shown: 0,
          drawnAt: 0,
          chips: 0,
          encircledSince: 0,
        },
        economy: economy?.economy ?? {
          capturesByHex: 0,
          cityFlashes: 0,
        },
        frontTween: economy?.frontTween ?? { byArmy: 0 },
      };
    },
  };
}
