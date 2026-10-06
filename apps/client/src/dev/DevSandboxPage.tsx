import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { ArmyBar } from './ArmyBar.tsx';
import styles from './DevSandboxPage.module.css';
import { EventFeed } from './EventFeed.tsx';
import { HexCard } from './HexCard.tsx';
import { Hud } from './Hud.tsx';
import { Leaderboard } from './Leaderboard.tsx';
import { MatchEnd } from './MatchEnd.tsx';
import { ObserverPanel } from './ObserverPanel.tsx';
import { UnitCard } from './UnitCard.tsx';
import { createEconomyLayer, type EconomyLayer } from './economy-layer.ts';
import { appendEvents, type EventFeedItem } from './event-feed.ts';
import { createOrderHooks } from './order-hooks.ts';
import type { Draft, DraftContext } from './plan-draft.ts';
import { createPlanInput, type ToolState } from './plan-tools.ts';
import { readSandboxMap, sandboxMapUrl, type SandboxMapRequest } from './sandbox-map.ts';
import {
  armySelection,
  NOTHING_PICKED,
  orderHex,
  selectHex,
  selectUnitsInRect,
  type Picked,
} from './sandbox-selection.ts';
import { createSplitGrab } from './split-drag.ts';
import { useTelemetry } from './telemetry-client.ts';
import {
  createSnapshotTelemetry,
  type CacheTelemetry,
  type PixiTelemetry,
  type SnapshotTelemetry,
  type SnapshotTelemetryCounts,
  type WorkerTelemetry,
} from './telemetry.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { hexCenter, type Point } from '../render/hex-geometry.ts';
import { createMapView, type MapView, type TapKind } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Наибольшее ускорение песочницы (тиков за 100 мс) — для записи матча. */
const SPEED_MAX = 20;

// Состав матча из адреса (04/T24): players — участников (человек + боты), watch=1 — человек тоже
// под ботом (запись матча ботов), speed — ускорение.
function matchSetup(search: string): { count: number; bots: number[]; speed: number } {
  const params = new URLSearchParams(search);
  const count = readSandboxMap(search).players;
  const watch = params.get('watch') === '1';
  const bots = Array.from({ length: count }, (_, i) => i).filter((i) => watch || i !== 0);
  const speed =
    params.get('freezeTime') === '1'
      ? 0
      : Math.min(SPEED_MAX, Math.max(1, Math.floor(Number(params.get('speed') ?? 1)) || 1));
  return { count, bots, speed };
}

type Loaded = { json: unknown; map: MapStatic } | 'loading' | 'error';

function useMapJson(request: SandboxMapRequest): Loaded {
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

type ViewMessage = Extract<FromWorker, { t: 'view' }>;

interface Sandbox {
  readonly msg: ViewMessage | null;
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
  setDockHeight(height: number): void;
  pixiTelemetry(): PixiTelemetry;
}

/** Локальный матч + карта: Web Worker, сцена Pixi, выбор и приказы кликом. */
function useSandbox(
  hostRef: React.RefObject<HTMLDivElement | null>,
  loaded: Loaded,
  mapRequest: SandboxMapRequest,
): Sandbox {
  const matchRef = useRef<LocalMatch | null>(null);
  const layerRef = useRef<EconomyLayer | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const pickedRef = useRef<Picked>(NOTHING_PICKED);
  const mapViewRef = useRef<MapView | null>(null);
  const toolRef = useRef<ToolState | null>(null);
  const armyRef = useRef<number | null>(null);
  const [tool, setToolState] = useState<ToolState | null>(null);
  const [army, setArmyState] = useState<number | null>(null);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const [lastReject, setLastReject] = useState<string | null>(null);
  const [fog, setFogState] = useState(true);
  const [paused, setPausedState] = useState(matchSetup(window.location.search).speed === 0);
  const [speed, setSpeedState] = useState(Math.max(1, matchSetup(window.location.search).speed));
  const [observerId, setObserverId] = useState<number | null>(null);
  const [events, setEvents] = useState<readonly EventFeedItem[]>([]);
  const eventsRef = useRef<readonly EventFeedItem[]>([]);
  const dockHeightRef = useRef(0);
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
    let pendingMessage: ViewMessage | null = null;
    let frameRequest = 0;
    let appliedMessage = false;
    const applyMessage = (m: ViewMessage): void => {
      snapshotTelemetryRef.current?.track(m);
      viewRef.current = m.view;
      workerTelemetryRef.current = m.telemetry ?? null;
      layerRef.current?.setView(m.view, pickedRef.current);
      setMsg(m);
      const nextEvents = appendEvents(eventsRef.current, m.events, m.view, performance.now());
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      const last = m.rejected.at(-1);
      if (last) setLastReject(reasonText(last.reason));
      matchRef.current?.ack(m.seq);
    };
    const scheduleMessage = (m: ViewMessage): void => {
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
      matchSetup(window.location.search),
      (m) => {
        if (m.t === 'error') return setError(m.errors.join('; '));
        scheduleMessage(m);
      },
    );
    matchRef.current = match;
    match.setView(null, false);
    setFogState(false);
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
      if (kind === 'select') return pick(selectHex(current, pickedRef.current, hex));
      order(hex);
    };
    // Приказ (ПКМ, отпущенное удержание): «идти» или «атаковать» сразу, без подтверждения.
    const order = (hex: number): void => {
      const current = viewRef.current;
      if (!current) return;
      const next = orderHex(current, pickedRef.current, hex);
      if (next.cmd) match.send(next.cmd);
      pick(next.picked);
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
    void createMapView(host, map, options, () => {}, onTap).then((v) => {
      if (cancelled) return v.destroy();
      view = v;
      mapViewRef.current = v;
      v.setBottomInset(dockHeightRef.current);
      // Сначала ручки фронта выбранной армии, потом — вытягивание части из своей фишки.
      v.setGrab((world) => input.grab(world) ?? splitGrab(world));
      v.setOrderHooks(hooks);
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
    };
  }, [hostRef, loaded, mapRequest, pick, input, setTool, splitGrab]);

  return {
    msg,
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
    setDockHeight(height) {
      dockHeightRef.current = height;
      mapViewRef.current?.setBottomInset(height);
    },
    pixiTelemetry() {
      return (
        mapViewRef.current?.sceneStats() ?? {
          objects: 0,
          text: 0,
          graphics: 0,
          textures: 0,
          canvasTextTextures: null,
        }
      );
    },
    cacheTelemetry() {
      return {
        unit: layerRef.current?.cacheTelemetry() ?? {
          shown: 0,
          drawnAt: 0,
          chips: 0,
          encircledSince: 0,
        },
      };
    },
  };
}

/** /dev/sandbox?map=small[&select=HexId&scale] — песочница: экономика, отряды, бой (03/T12). */
export function DevSandboxPage(): React.JSX.Element {
  const mapRequest = useMemo(() => readSandboxMap(window.location.search), []);
  const loaded = useMapJson(mapRequest);
  const hostRef = useRef<HTMLDivElement>(null);
  const sb = useSandbox(hostRef, loaded, mapRequest);
  const downloadTelemetry = useTelemetry({
    view: () => sb.msg?.view ?? null,
    pixi: sb.pixiTelemetry,
    worker: () => sb.workerTelemetry,
    snapshots: sb.snapshotTelemetry,
    caches: sb.cacheTelemetry,
  });
  // Карточки гекса и отряда — над нижней панелью: её высота меряется, а не задаётся числом.
  const [dockH, setDockH] = useState(0);
  const [observerH, setObserverH] = useState(0);
  const { army } = sb;
  const view = sb.msg?.view;
  // Выбрана армия целиком — её сводка в нижней панели, карточка отряда не нужна (как в HoI4).
  const armyUnits = view?.units.filter((u) => u.armyId !== null && u.armyId === army) ?? [];
  const armyPicked =
    armyUnits.length > 0 &&
    armyUnits.length === sb.picked.units.length &&
    armyUnits.every((u) => sb.picked.units.includes(u.id));
  const map = typeof loaded === 'string' ? null : loaded.map;
  // Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке.
  const partial = view ? armySelection(view, sb.picked.units).partial : [];
  return (
    <div className={styles.page} style={{ '--dock-h': `${dockH}px` } as React.CSSProperties}>
      <div ref={hostRef} className={styles.map} />
      <EventFeed
        items={sb.events}
        now={performance.now()}
        onFocus={sb.focusEvent}
        style={{ '--observer-h': `${observerH}px` } as React.CSSProperties}
      />
      {view && <Hud view={view} send={sb.send} fog={sb.fog} setFog={sb.setFog} />}
      {view && (
        <ObserverPanel
          view={view}
          paused={sb.paused}
          speed={sb.speed}
          observerId={sb.observerId}
          setPaused={sb.setPaused}
          step={sb.step}
          setSpeed={sb.setSpeed}
          setObserver={sb.setObserver}
          downloadTelemetry={downloadTelemetry}
          onHeight={setObserverH}
        />
      )}
      {view && <Leaderboard view={view} />}
      {view && <MatchEnd view={view} />}
      {view && (
        <ArmyBar
          view={view}
          selected={view.armies.some((a) => a.id === army) ? army : null}
          partial={partial.filter((a) => a !== army)}
          onHeight={(height) => {
            setDockH(height);
            sb.setDockHeight(height);
          }}
          onSelect={sb.setArmy}
          send={sb.send}
          onPick={sb.pick}
          tool={sb.tool}
          onTool={sb.setTool}
        />
      )}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {view && map && sb.picked.units.length > 0 && !sb.tool && !armyPicked && (
        <UnitCard view={view} map={map} picked={sb.picked} send={sb.send} onPick={sb.pick} />
      )}
      {view && map && sb.picked.units.length === 0 && !sb.tool && sb.msg?.selection && (
        <HexCard
          s={sb.msg.selection}
          view={view}
          map={map}
          send={sb.send}
          onRoadPreview={sb.setRoadPreview}
        />
      )}
      {sb.lastReject && (
        <p className={styles.reject}>
          {t('dev.economy.lastRejection')}: {sb.lastReject}
        </p>
      )}
    </div>
  );
}
