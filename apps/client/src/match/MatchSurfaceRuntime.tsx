import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  neighbors,
  TERRAIN,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { coastPath, isOwnCoast, ownCoast } from './coast-defense.ts';
import { useInvasion, type Invasion } from './invasion.ts';
import { useMapModes, type MapModes } from './map-modes.ts';
import { applyStartCamera as applyStartCameraToMap } from './start-camera.ts';
import { orderArmy } from '../dev/army-order.ts';
import { armyCounts, orderFields } from '../dev/direction-order.ts';
import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { appendEvents, type EventFeedItem } from '../dev/event-feed.ts';
import { applyHudPreview, readHudPreview } from '../dev/hud-preview.ts';
import { createOrderHooks } from '../dev/order-hooks.ts';
import { EMPTY_QUEUE, queueOrder, remainingPoints, type OrderQueue } from '../dev/order-queue.ts';
import type { Draft, DraftContext } from '../dev/plan-draft.ts';
import { createPlanInput, type ToolState } from '../dev/plan-tools.ts';
import { sandboxMapUrl, type SandboxMapRequest } from '../dev/sandbox-map.ts';
import {
  armySelection,
  NOTHING_PICKED,
  orderHex,
  selectHexOnly,
  selectUnits,
  selectUnitsInRect,
  type Picked,
} from '../dev/sandbox-selection.ts';
import {
  createSnapshotTelemetry,
  type CacheTelemetry,
  type PixiTelemetry,
  type SnapshotTelemetry,
  type SnapshotTelemetryCounts,
  type WorkerTelemetry,
} from '../dev/telemetry.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { ControlGroups } from '../input/control-groups.ts';
import { createHotkeyHandler } from '../input/hotkeys.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import { readLocalMatchSetup } from '../local/match-setup.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { hexCenter, pixelToHex, type Point } from '../render/hex-geometry.ts';
import { createMapView, type MapView, type TapKind } from '../render/map-view.ts';
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
/**
 * Двойное нажатие на фишку: выбираются все свои отряды того же типа в видимой области; камера
 * центрируется только если таких отрядов нет, кроме нажатой (07-controls.md).
 */
export function focusUnitOnDoubleTap(options: {
  view: PlayerView;
  map: MapStatic;
  hex: { readonly q: number; readonly r: number };
  hit: readonly number[];
  visible: { readonly from: Point; readonly to: Point } | null;
  chipBounds: (unitId: number) => {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  } | null;
  pick: (picked: Picked) => void;
  centerOn: (hex: { readonly q: number; readonly r: number }, durationMs: number) => void;
}): void {
  const { view, map, hit } = options;
  if (hit.length === 0) return;
  const pressed = selectUnits(view, NOTHING_PICKED, hit);
  const tapped = view.units.find((candidate) => pressed.units.includes(candidate.id));
  const sameType = tapped
    ? selectUnitsInRect(
        view,
        options.visible?.from ?? { x: 0, y: 0 },
        options.visible?.to ?? { x: 0, y: 0 },
        options.chipBounds,
      ).filter((id) => view.units.find((u) => u.id === id)?.type === tapped.type)
    : [];
  if (tapped && sameType.some((id) => id !== tapped.id)) {
    options.pick({ hex: null, units: sameType, target: null });
    return;
  }
  options.pick(pressed);
  options.centerOn(
    hexFromId(tapped?.hex ?? hexId(options.hex, map.width), map.width),
    tokens.motion.map,
  );
}

export function createDoubleTapHandler(options: {
  getView: () => PlayerView | null;
  map: MapStatic;
  getHit: (world: Point) => readonly number[];
  getVisible: () => { readonly from: Point; readonly to: Point } | null;
  chipBounds: (unitId: number) => {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  } | null;
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
      hit,
      visible: options.getVisible(),
      chipBounds: options.chipBounds,
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
  /** Накопленные Shift+ПКМ точки маршрута (черновик очищается). */
  takeVia?: () => readonly number[];
}): (hex: number) => void {
  return (hex): void => {
    const view = options.getView();
    if (!view) return;
    const next = orderHex(view, options.getPicked(), hex, options.takeVia?.());
    if (next.cmd) options.send(next.cmd);
    options.pick(next.picked);
  };
}
type PlayerColorId = (typeof tokens.players.palette)[number]['id'];

const NICKNAME_KEY = 'hexfront.nickname';
const COLOR_KEY = 'hexfront.color';

function matchPlayerColors(selected: string): readonly PlayerColorId[] {
  return playerColorIds(selected) as readonly PlayerColorId[];
}

/** Меню земли: владелец (-1 — ничья), гекс и точка нажатия в координатах страницы. */
export interface TerritoryMenuState {
  readonly other: number;
  readonly hex: number;
  readonly x: number;
  readonly y: number;
}

interface Sandbox {
  readonly msg: ViewMessage | null;
  readonly error: string | null;
  readonly picked: Picked;
  readonly menu: TerritoryMenuState | null;
  closeMenu(): void;
  readonly mapModes: MapModes;
  /** Морское вторжение: выбор порта отправки и гекса высадки. */
  readonly invasion: Invasion;
  readonly lastReject: string | null;
  readonly tool: ToolState | null;
  /** Армия, для которой «Держать» ждёт выбора страны на карте. */
  readonly holdPick: number | null;
  setHoldPick(armyId: number | null): void;
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
  /** Центрирует камеру на гексе и открывает его карточку. */
  focusHex(hex: number): void;
  /** Видимая область карты в мировых координатах (обучение следит за камерой и ставит метки). */
  cameraRect(): { readonly from: Point; readonly to: Point } | null;
  /** Центрирует камеру на гексе, ничего не выбирая. */
  centerOnHex(hex: number): void;
  /** Подписка на сдвиг камеры (плашки на карте); возвращает отписку. */
  subscribeCamera(listener: () => void): () => void;
  /** Центр гекса в мировых координатах. */
  hexWorld(hex: number): Point | null;
  /** Центр фишки отряда на гексе в мировых координатах. */
  chipWorld(hex: number): Point | null;
  send(cmd: Command): void;
  setFog(on: boolean): void;
  /** Шаг матча-урока для режиссёра соперника. */
  setTutorialStage(stage: string): void;
  setPaused(on: boolean): void;
  step(): void;
  setSpeed(value: number): void;
  setObserver(playerId: number | null): void;
  pick(p: Picked): void;
  setTool(t: ToolState | null): void;
  setArmy(id: number | null): void;
  focusArmy(id: number): void;
  groupDigits: number[];
  setRoadPreview(path: readonly number[] | null): void;
  setDockHeight(height: number, leaderboardWidth?: number): void;
  setHudHeight(height: number, leaderboardWidth?: number): void;
  pixiTelemetry(): PixiTelemetry;
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
  const groups = useMemo(() => new ControlGroups(), []);
  const [groupTick, bumpGroups] = useReducer((n: number) => n + 1, 0);
  useEffect(() => groups.subscribe(bumpGroups), [groups]);
  const armyRef = useRef<number | null>(null);
  const [tool, setToolState] = useState<ToolState | null>(null);
  const cameraListenersRef = useRef(new Set<() => void>());
  const holdPickRef = useRef<number | null>(null);
  const coastStartRef = useRef<number | null>(null);
  const [holdPick, setHoldPickState] = useState<number | null>(null);
  // Пока армия ждёт цель «Держать», свои гексы у моря подсвечены: линия обороны вдоль берега.
  useEffect(() => {
    if (holdPick === null) return;
    const current = viewRef.current;
    if (!current || typeof loaded === 'string') return;
    const mask = new Uint8Array(current.hexes.owner.length);
    for (const h of ownCoast(current, loaded.map)) mask[h] = 1;
    layerRef.current?.setMapMask('build', mask);
    return () => {
      layerRef.current?.setMapMask(null, null);
      coastStartRef.current = null;
    };
  }, [holdPick, loaded]);
  const setHoldPick = useCallback((armyId: number | null) => {
    holdPickRef.current = armyId;
    setHoldPickState(armyId);
    // Подсветка стран, против которых можно держать фронт: маска стройки (светлое — можно).
    const v = viewRef.current;
    if (armyId === null || !v) {
      layerRef.current?.setMapMask(null, null);
      return;
    }
    const mask = new Uint8Array(v.hexes.owner.length);
    for (let i = 0; i < mask.length; i += 1) {
      const owner = v.hexes.owner[i] ?? -1;
      if (owner >= 0 && owner !== v.playerId && v.players[owner]?.status === 'alive') mask[i] = 1;
    }
    layerRef.current?.setMapMask('build', mask);
  }, []);
  const [army, setArmyState] = useState<number | null>(null);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const [menu, setMenu] = useState<TerritoryMenuState | null>(null);
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

  const mapModes = useMapModes(matchRef, layerRef);
  const mapModesRef = useRef(mapModes);
  mapModesRef.current = mapModes;
  const invasion = useInvasion(layerRef, () => {
    const current = viewRef.current;
    return current && typeof loaded !== 'string' ? { view: current, map: loaded.map } : null;
  });
  const invasionRef = useRef(invasion);
  invasionRef.current = invasion;

  const queueRef = useRef<OrderQueue>(EMPTY_QUEUE);
  const syncQueueMarks = useCallback(() => {
    const v = viewRef.current;
    const points = v ? remainingPoints(v, pickedRef.current, queueRef.current) : [];
    layerRef.current?.setQueueMarks(points);
  }, []);

  const pick = useCallback(
    (p: Picked) => {
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
      syncQueueMarks();
    },
    [syncQueueMarks],
  );
  const send = useCallback((cmd: Command) => matchRef.current?.send(cmd), []);
  const setTutorialStage = useCallback((stage: string) => {
    matchRef.current?.setTutorialStage?.(stage);
  }, []);
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
  const focusArmy = useCallback(
    (id: number) => {
      const view = viewRef.current;
      if (!view || typeof loaded === 'string') return;
      const units = view.units.filter((unit) => unit.armyId === id);
      const firstUnit = units[0];
      setArmy(id);
      pick({ hex: null, units: units.map((unit) => unit.id), target: null });
      if (firstUnit) {
        mapViewRef.current?.centerOn(hexFromId(firstUnit.hex, loaded.map.width), tokens.motion.map);
      }
    },
    [loaded, pick, setArmy],
  );
  const setRoadPreview = useCallback((path: readonly number[] | null) => {
    layerRef.current?.setRoadPreview(path);
  }, []);
  const setArmyRef = useRef(setArmy);
  // setTool зависит от input, а input вызывает setTool — связь через ссылку.
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
    const hudPreview = import.meta.env.DEV ? readHudPreview(window.location.search) : null;
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
      const receivedView =
        m.kind === 'snapshot'
          ? deltaApplier.applySnapshot(m.snapshot)
          : deltaApplier.applyDelta(m.delta);
      const view = applyHudPreview(receivedView, hudPreview);
      const applied = { ...m, view } as ViewMessage;
      snapshotTelemetryRef.current?.track(applied);
      viewRef.current = view;
      applyStartCameraToView(view);
      workerTelemetryRef.current = m.telemetry ?? null;
      layerRef.current?.setView(view, pickedRef.current);
      syncQueueMarks();
      setMsg(applied);
      const nextEvents = appendEvents(
        eventsRef.current,
        m.events,
        view,
        performance.now(),
        view.playerId,
      );
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
        // Ответ предпросмотра пути обрабатывает клиент маршрута (T17dg).
        if (m.t === 'pathPreview') return;
        if (m.t === 'mapMask') return mapModesRef.current.handleReply(m);
        scheduleMessage(m);
      },
      {
        telemetry: debug,
        initialGold: setup.initialGold,
        tutorial: setup.tutorial !== null,
        playerName:
          setup.playerName ?? localStorage.getItem(NICKNAME_KEY) ?? `${t('observer.player')} 1`,
        playerColors: matchPlayerColors(
          setup.playerColor ?? localStorage.getItem(COLOR_KEY) ?? 'teal',
        ),
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
    // Меню чужой страны: ЛКМ или ПКМ (удержание пальцем) без выбранных отрядов по земле другого игрока.
    const openMenuAt = (hex: number, screen: Point | undefined): boolean => {
      const current = viewRef.current;
      if (!current || !screen) return false;
      const owner = current.hexes.owner[hex] ?? -1;
      if (owner === current.playerId) return false;
      // Ничья суша — тоже направление («занять»); вода — нет.
      if (owner < 0 && map.terrain[hex] === TERRAIN.water) return false;
      // Выбрана армия — тап по ничьей земле сразу ставит ей занятие, без меню.
      const picked = current.armies.find((a) => a.id === armyRef.current);
      if (owner < 0 && picked) {
        match.send(orderArmy(current, picked, -1, 'attack', hex));
        return true;
      }
      setMenu({ other: owner, hex, x: screen.x, y: screen.y });
      return true;
    };
    const onTap = (
      h: { q: number; r: number },
      kind: TapKind,
      world: Point,
      shift?: boolean,
      screen?: Point,
    ): void => {
      const current = viewRef.current;
      setMenu(null);
      // «Держать» без приказа: следующий тап по чужой стране ставит армии фронт на её границе.
      const holdArmy = holdPickRef.current;
      if (holdArmy !== null) {
        const tapped = inBounds(h, map.width, map.height) ? hexId(h, map.width) : -1;
        // Свой берег: два нажатия (начало и конец участка) ставят армии линию обороны вдоль моря.
        if (current && tapped >= 0 && isOwnCoast(current, map, tapped)) {
          const first = coastStartRef.current;
          if (first === null) {
            coastStartRef.current = tapped;
            layerRef.current?.setQueueMarks([tapped]);
            return;
          }
          const line = coastPath(current, map, first, tapped);
          coastStartRef.current = null;
          layerRef.current?.setQueueMarks([]);
          if (line) {
            setHoldPick(null);
            match.send({ t: 'setDefenseLine', armyId: holdArmy, points: line });
          }
          return;
        }
        coastStartRef.current = null;
        layerRef.current?.setQueueMarks([]);
        setHoldPick(null);
        const owner =
          current && inBounds(h, map.width, map.height)
            ? (current.hexes.owner[hexId(h, map.width)] ?? -1)
            : -1;
        const army = current?.armies.find((a) => a.id === holdArmy);
        if (current && army && owner >= 0 && owner !== current.playerId) {
          match.send({
            t: 'holdBorder',
            target: owner,
            ...orderFields(armyCounts(current, army), army.id),
          });
        }
        return;
      }
      if (!current || !inBounds(h, map.width, map.height)) {
        return toolRef.current ? undefined : pick(NOTHING_PICKED);
      }
      const hex = hexId(h, map.width);
      // Shift+ПКМ: цепочка приказов — точка добавляется после предыдущих, отряды идут сразу.
      if (
        kind === 'order' &&
        shift &&
        pickedRef.current.units.length > 0 &&
        mapModesRef.current.build === null
      ) {
        const next = queueOrder(current, pickedRef.current, hex, queueRef.current);
        if (next) {
          queueRef.current = next.queue;
          match.send(next.cmd);
          syncQueueMarks();
        }
        return;
      }
      // Морское вторжение: два нажатия (порт отправки, гекс высадки); ПКМ и Esc отменяют.
      if (invasionRef.current.stage !== 'off') {
        if (kind === 'order') return invasionRef.current.cancel();
        if (invasionRef.current.clickHex(hex, (cmd) => match.send(cmd))) return;
      }
      // Режим строительства: ЛКМ по подсвеченному гексу строит, ПКМ выходит из режима.
      if (mapModesRef.current.build !== null) {
        if (kind === 'order') return mapModesRef.current.setBuild(null);
        if (mapModesRef.current.clickHex(hex, (cmd) => match.send(cmd), screen)) return;
      }
      if (input.tap(world, kind) || input.onHandle(world)) return;
      if (kind === 'order' && pickedRef.current.units.length === 0 && openMenuAt(hex, screen)) {
        return;
      }
      if (kind === 'select') {
        const hit = layerRef.current?.unitsAt(world) ?? [];
        if (hit.length > 0) return pick(selectUnits(current, pickedRef.current, hit));
        // ЛКМ по чужой или ничьей земле — то же меню, что по ПКМ; карточка чужого гекса не открывается.
        if ((current.hexes.owner[hex] ?? -1) !== current.playerId) {
          if (pickedRef.current.units.length === 0) openMenuAt(hex, screen);
          return pick(NOTHING_PICKED);
        }
        return pick(selectHexOnly(hex));
      }
      order(hex);
    };
    const onDoubleTap = createDoubleTapHandler({
      getView: () => viewRef.current,
      map,
      getHit: (world) => layerRef.current?.unitsAt(world) ?? [],
      getVisible: () => mapViewRef.current?.visibleWorldRect?.() ?? null,
      chipBounds: (id) => layerRef.current?.chipBounds(id) ?? null,
      pick,
      centerOn: (hex, durationMs) => mapViewRef.current?.centerOn(hex, durationMs),
    });
    // Приказ (ПКМ, отпущенное удержание): «идти» или «атаковать» сразу, без подтверждения.
    const plainOrder = createOrderHandler({
      getView: () => viewRef.current,
      getPicked: () => pickedRef.current,
      send: (command) => match.send(command),
      pick,
    });
    // Обычный приказ заменяет цепочку Shift+ПКМ.
    const order = (hex: number): void => {
      queueRef.current = EMPTY_QUEUE;
      plainOrder(hex);
      syncQueueMarks();
    };
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
      markerAt: (world) => layerRef.current?.battleMarkerAt(world) ?? null,
      setBattlePanel: (m) => layerRef.current?.setBattlePanel(m),
      holdWithoutUnits: (world, screen) => {
        const h = pixelToHex(world, tokens.map.hexRadius);
        if (!inBounds(h, map.width, map.height)) return;
        if (!openMenuAt(hexId(h, map.width), screen)) onTap(h, 'select', world);
      },
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
      v.onCamera(() => {
        for (const listener of cameraListenersRef.current) listener();
      });
      const currentTool = toolRef.current;
      v.setStroke(currentTool && currentTool.tool !== 'erase' ? input.stroke : null);
      if (viewRef.current) applyStartCameraToView(viewRef.current);
      v.setBottomInset(dockHeightRef.current);
      v.setTopInset(hudHeightRef.current);
      v.setTopInset(hudHeightRef.current, rightInsetRef.current);
      // Сначала ручки фронта выбранной армии, потом — вытягивание части из своей фишки.
      v.setGrab((world) => (toolRef.current ? null : input.grab(world)));
      v.setOrderHooks(hooks);
      v.setSelection((from, to, phase) => {
        if (phase !== 'end') return;
        const units = viewRef.current
          ? selectUnitsInRect(
              viewRef.current,
              from,
              to,
              (id) => layerRef.current?.chipBounds(id) ?? null,
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
    const onKey = createHotkeyHandler({
      latestEventHex: () => eventsRef.current.at(-1)?.hex ?? null,
      centerOnHex: (hex) => mapViewRef.current?.centerOn(hexFromId(hex, map.width)),
      cancelMap: () => mapViewRef.current?.cancel(),
      toolActive: () => toolRef.current !== null || holdPickRef.current !== null,
      cancelTool: () => {
        input.cancel();
        setTool(null);
        setHoldPick(null);
      },
      clearPick: () => {
        pick(NOTHING_PICKED);
      },
      view: () => viewRef.current,
      picked: () => pickedRef.current,
      selectedArmy: () => armyRef.current,
      setArmy: (id) => setArmyRef.current(id),
      send: (cmd) => matchRef.current?.send(cmd),
      groups,
      selectUnits: (ids) => pick({ hex: null, units: [...ids], target: null }),
    });
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
    };
  }, [hostRef, loaded, mapRequest, pick, input, setTool, debug]);

  // groupTick меняется при записи группы; состав отрядов берётся из последнего вида.
  const groupDigits = useMemo(
    () => groups.occupied(new Set(msg?.view.units.map((u) => u.id) ?? [])),
    [groups, msg, groupTick],
  );

  return {
    msg,
    error,
    picked,
    menu,
    closeMenu: () => setMenu(null),
    mapModes,
    invasion,
    lastReject,
    tool,
    holdPick,
    setHoldPick,
    army,
    send,
    fog,
    paused,
    speed,
    observerId,
    events,
    workerTelemetry: workerTelemetryRef.current,
    snapshotTelemetry: () =>
      snapshotTelemetryRef.current?.counts() ?? { received: 0, collected: 0, live: 0 },
    focusEvent(item) {
      if (item.hex !== null && typeof loaded !== 'string') {
        mapViewRef.current?.centerOn(hexFromId(item.hex, loaded.map.width));
      }
    },
    cameraRect: () => mapViewRef.current?.visibleWorldRect?.() ?? null,
    centerOnHex(hex) {
      if (typeof loaded !== 'string') {
        mapViewRef.current?.centerOn(hexFromId(hex, loaded.map.width), tokens.motion.map);
      }
    },
    subscribeCamera(listener) {
      cameraListenersRef.current.add(listener);
      return () => cameraListenersRef.current.delete(listener);
    },
    hexWorld(hex) {
      if (typeof loaded === 'string') return null;
      return hexCenter(hexFromId(hex, loaded.map.width), tokens.map.hexRadius);
    },
    chipWorld(hex) {
      return layerRef.current?.chipAt(hex) ?? null;
    },
    focusHex(hex) {
      if (typeof loaded !== 'string') {
        mapViewRef.current?.centerOn(hexFromId(hex, loaded.map.width), tokens.motion.map);
      }
      pick({ hex, units: [], target: null });
    },
    setFog,
    setTutorialStage,
    setPaused,
    step,
    setSpeed,
    setObserver,
    pick,
    setTool,
    setArmy,
    focusArmy,
    groupDigits,
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
