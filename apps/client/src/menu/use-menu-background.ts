// Живая карта за меню: партия шести ботов идёт в обычном темпе, камера плывёт от города к городу,
// ни за кем конкретно не следя. Партия начинается за кадром и показывается, когда армии уже
// сошлись; когда остаётся один, она заканчивается, и начинается новая.
import { useEffect, type RefObject } from 'react';

import { loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { startLocalMatch } from '../local/local-match.ts';
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
/** Подготовка за кадром: партия считается быстро, пока не пройдёт столько тиков или миллисекунд. */
const WARM_SPEED = 60;
const WARM_TICKS = 3000;
const WARM_MAX_MS = 7000;
/** Как часто камера выбирает новое место и сколько летит к нему, мс. */
const GLIDE_EVERY_MS = 12_000;
const GLIDE_MS = 10_000;
/** Пауза после победителя, прежде чем начать новую партию, и длительность проявления, мс. */
const AFTER_WIN_MS = 9000;
const FADE_MS = 800;

/** Запускает фоновую партию в `hostRef`. */
export function useMenuBackground(hostRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let stopResize: (() => void) | null = null;
    let glide: ReturnType<typeof setInterval> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let match: ReturnType<typeof startLocalMatch> | null = null;
    let deltaApplier = new ViewDeltaApplier();
    let json: unknown = null;
    let warming = true;
    let finished = false;

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
    const endWarmUp = (): void => {
      if (!warming) return;
      warming = false;
      match?.setSpeed(1);
      show(true);
    };
    const launch = (): void => {
      if (disposed || json === null) return;
      match?.dispose();
      deltaApplier = new ViewDeltaApplier();
      warming = true;
      finished = false;
      match = startLocalMatch(
        json,
        1 + Math.floor(Math.random() * 1_000_000),
        { count: BOTS, bots: Array.from({ length: BOTS }, (_, i) => i), speed: WARM_SPEED },
        (message: FromWorker): void => {
          if (message.t === 'view') applyMessage(message);
        },
        { fog: false },
      );
      later(WARM_MAX_MS, endWarmUp);
    };
    function applyMessage(message: Extract<FromWorker, { t: 'view' }>): void {
      // Без подтверждения воркер перестаёт слать виды (защита от перегруза).
      match?.ack(message.seq);
      const view =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      layer?.setView(view, EMPTY_SELECTION);
      layer?.frame(performance.now());
      if (warming && view.tick >= WARM_TICKS) endWarmUp();
      if (!finished && message.events.some((event) => event.t === 'matchWon')) {
        finished = true;
        later(AFTER_WIN_MS, () => {
          show(false);
          later(FADE_MS, launch);
        });
      }
    }

    const start = async (): Promise<void> => {
      const response = await fetch('/maps/small.json');
      json = (await response.json()) as unknown;
      const loaded = loadMap(json);
      const host = hostRef.current;
      if (disposed || !loaded.ok || host === null) return;
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
      );
      if (disposed) {
        created.destroy();
        return;
      }
      mapView = created;
      const bounds = mapBounds(loaded.map.width, loaded.map.height, tokens.map.hexRadius);
      const frame = (): void => {
        const cover = Math.max(host.clientWidth / bounds.width, host.clientHeight / bounds.height);
        created.setScale(Math.max(cover, WATCH_SCALE));
      };
      frame();
      const observer = new ResizeObserver(frame);
      observer.observe(host);
      stopResize = () => observer.disconnect();
      const cities = loaded.map.cities;
      const glideTo = (ms: number): void => {
        const city = cities[Math.floor(Math.random() * cities.length)];
        if (city !== undefined) created.centerOn({ q: city.q, r: city.r }, ms);
      };
      glideTo(0);
      glide = setInterval(() => glideTo(GLIDE_MS), GLIDE_EVERY_MS);
      launch();
    };
    void start();
    return () => {
      disposed = true;
      if (glide !== null) clearInterval(glide);
      for (const id of timers) clearTimeout(id);
      stopResize?.();
      match?.dispose();
      layer?.destroy();
      mapView?.destroy();
    };
  }, [hostRef]);
}
