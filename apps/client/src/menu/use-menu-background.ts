// Живая карта за меню: партия шести ботов идёт в обычном темпе, камера плывёт от города к городу,
// ни за кем конкретно не следя. Партия начинается сразу с первого тика; когда остаётся один, она заканчивается, и начинается новая.
import { useEffect, useRef, type RefObject } from 'react';

import { hexId, loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { startLocalMatch } from '../local/local-match.ts';
import { loadMapJson, type MapRequest } from '../local/map-request.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { mapBounds } from '../render/hex-geometry.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;
/** Малая карта на шесть армий: стартовые земли рядом, поэтому границы сходятся и войны идут быстро. */
const BOTS = 6;
/** Масштаб кадра: на этом уровне уже видны отряды и границы, а в кадр попадает много земель. */
const WATCH_SCALE = 0.8;
/** Пока зритель сам двигает карту, камера не уплывает: столько мс после последнего касания. */
const USER_HOLD_MS = 25_000;
/** Как часто камера выбирает новое место и сколько летит к нему, мс. */
const GLIDE_EVERY_MS = 12_000;
const GLIDE_MS = 10_000;
/** Пауза после победителя, прежде чем начать новую партию, и длительность проявления, мс. */
const AFTER_WIN_MS = 9000;
const FADE_MS = 800;

/**
 * Выбор старта тапом по фону: номер точки старта на карте (индекс в `map.spawns`) или `null` —
 * случайно. Ближайшая точка находится по тапу, сами точки не показываются.
 */
export interface StartPicker {
  readonly spawn: number | null;
  readonly onPick: (spawn: number | null) => void;
}

/** Расстояние между гексами в осевых координатах. */
function hexSteps(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Запускает фоновую партию в `hostRef`; `picker` включает выбор старта тапом по карте. */
export function useMenuBackground(
  hostRef: RefObject<HTMLDivElement | null>,
  request: MapRequest,
  picker: StartPicker | null = null,
): void {
  const { id, seed, size } = request;
  const pickerRef = useRef(picker);
  const markerRef = useRef<() => void>(() => undefined);
  const pickedSpawn = picker?.spawn ?? null;
  useEffect(() => {
    pickerRef.current = picker;
    markerRef.current();
  }, [picker, pickedSpawn]);
  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let stopResize: (() => void) | null = null;
    let stopInput: (() => void) | null = null;
    let glide: ReturnType<typeof setInterval> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let match: ReturnType<typeof startLocalMatch> | null = null;
    let deltaApplier = new ViewDeltaApplier();
    let json: unknown = null;
    let finished = false;
    let bots = BOTS;

    const later = (ms: number, action: () => void): void => {
      const id = setTimeout(() => {
        timers.delete(id);
        action();
      }, ms);
      timers.add(id);
    };
    const show = (visible: boolean): void => {
      const host = hostRef.current;
      if (host === null) return;
      host.style.transition = `opacity ${FADE_MS}ms ease`;
      host.style.opacity = visible ? '1' : '0';
    };
    const launch = (): void => {
      if (disposed || json === null) return;
      match?.dispose();
      deltaApplier = new ViewDeltaApplier();
      finished = false;
      match = startLocalMatch(
        json,
        1 + Math.floor(Math.random() * 1_000_000),
        { count: bots, bots: Array.from({ length: bots }, (_, i) => i), speed: 1 },
        (message: FromWorker): void => {
          if (message.t === 'view') applyMessage(message);
        },
        { fog: false },
      );
      show(true);
    };
    function applyMessage(message: Extract<FromWorker, { t: 'view' }>): void {
      // Без подтверждения воркер перестаёт слать виды (защита от перегруза).
      match?.ack(message.seq);
      const view =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      // Зритель: ни одна армия не «своя», все отряды показываются одинаково.
      layer?.setView({ ...view, armies: [] }, EMPTY_SELECTION);
      layer?.frame(performance.now());
      if (!finished && message.events.some((event) => event.t === 'matchWon')) {
        finished = true;
        later(AFTER_WIN_MS, () => {
          show(false);
          later(FADE_MS, launch);
        });
      }
    }

    const start = async (): Promise<void> => {
      json = await loadMapJson({ id, seed, size, players: BOTS });
      const loaded = loadMap(json);
      const host = hostRef.current;
      if (disposed || !loaded.ok || host === null) return;
      bots = Math.min(BOTS, loaded.map.spawns.length);
      host.style.opacity = '0';
      const created = await createMapView(
        host,
        loaded.map,
        {
          radius: tokens.map.hexRadius,
          midLayer: (map, radius) => {
            layer = createEconomyLayer(map, radius);
            // Подписи государств на фоне не нужны: «Игрок 1» поверх земли только мешает.
            layer.territoryLabels.visible = false;
            return layer;
          },
        },
        () => undefined,
        (hex, kind) => {
          const current = pickerRef.current;
          if (current === null || kind !== 'select') return;
          let best = -1;
          let bestSteps = Infinity;
          loaded.map.spawns.forEach((spawn, index) => {
            const steps = hexSteps(spawn, hex);
            if (steps < bestSteps) {
              best = index;
              bestSteps = steps;
            }
          });
          if (best >= 0) current.onPick(current.spawn === best ? null : best);
        },
      );
      if (disposed) {
        created.destroy();
        return;
      }
      mapView = created;
      markerRef.current = () => {
        const spawn = pickerRef.current?.spawn ?? null;
        const at = spawn === null ? undefined : loaded.map.spawns[spawn];
        layer?.setStartMarker(at === undefined ? null : hexId(at, loaded.map.width));
      };
      markerRef.current();
      const bounds = mapBounds(loaded.map.width, loaded.map.height, tokens.map.hexRadius);
      const frame = (): void => {
        const cover = Math.max(host.clientWidth / bounds.width, host.clientHeight / bounds.height);
        created.setScale(Math.max(cover, WATCH_SCALE));
      };
      frame();
      const observer = new ResizeObserver(frame);
      observer.observe(host);
      stopResize = () => observer.disconnect();
      // Колесо и жесты пальцев карта разбирает сама; левой кнопкой мыши её тянем здесь.
      let touchedAt = -Infinity;
      const onMove = (event: PointerEvent): void => {
        touchedAt = performance.now();
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 1) {
          created.pan(event.movementX, event.movementY);
        }
      };
      host.addEventListener('pointermove', onMove);
      const onWheel = (): void => {
        touchedAt = performance.now();
      };
      host.addEventListener('wheel', onWheel, { passive: true });
      stopInput = () => {
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('wheel', onWheel);
      };
      const cities = loaded.map.cities;
      const glideTo = (ms: number): void => {
        const city = cities[Math.floor(Math.random() * cities.length)];
        if (city !== undefined) created.centerOn({ q: city.q, r: city.r }, ms);
      };
      glideTo(0);
      glide = setInterval(() => {
        if (performance.now() - touchedAt > USER_HOLD_MS) glideTo(GLIDE_MS);
      }, GLIDE_EVERY_MS);
      launch();
    };
    void start();
    return () => {
      disposed = true;
      if (glide !== null) clearInterval(glide);
      for (const id of timers) clearTimeout(id);
      stopResize?.();
      stopInput?.();
      match?.dispose();
      markerRef.current = () => undefined;
      layer?.destroy();
      mapView?.destroy();
    };
  }, [hostRef, id, seed, size]);
}
