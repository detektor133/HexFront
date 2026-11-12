// Живая карта за меню: полноценная партия шести ботов идёт на настоящей карте, а камера
// не стоит на месте, а плывёт от города к городу, чтобы было за чем следить.
import { useEffect, type RefObject } from 'react';

import { loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { startLocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { mapBounds } from '../render/hex-geometry.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;
/** Партия на фоне идёт вдвое быстрее обычной: сражения видны, а слабому телефону не тяжело. */
const BACKGROUND_SPEED = 2;
/** Первые секунды партия идёт в ускоренной перемотке: к показу меню армии уже сошлись в бою. */
const TIMELAPSE_SPEED = 40;
const TIMELAPSE_MS = 12_000;
/** Малая карта на шесть армий: стартовые земли рядом, поэтому границы сходятся и войны идут быстро. */
const BOTS = 6;
/** Партия на фоне перезапускается с новой картой расстановки: победитель всё закончил бы и застыл. */
const RESTART_MS = 180_000;
/** Масштаб кадра: на этом уровне уже видны отряды и границы, а в кадр попадает много земель. */
const WATCH_SCALE = 0.8;
/** Как часто камера выбирает новое место и сколько летит к нему, мс. */
const GLIDE_EVERY_MS = 9000;
const GLIDE_MS = 8000;

/** Запускает фоновую партию в `hostRef`; `color` — цвет игрока, которым красится одна из армий. */
export function useMenuBackground(hostRef: RefObject<HTMLDivElement | null>, color: string): void {
  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let stopResize: (() => void) | null = null;
    let glide: ReturnType<typeof setInterval> | null = null;
    let slowDown: ReturnType<typeof setTimeout> | null = null;
    // Последний вид: сообщения применяются сразу, а не ждут холст. Иначе дельты, пришедшие до готовности
    // карты, терялись бы, и партия на экране застывала на первом кадре.
    let latest: ReturnType<ViewDeltaApplier['applySnapshot']> | null = null;
    let match: ReturnType<typeof startLocalMatch> | null = null;
    let deltaApplier = new ViewDeltaApplier();
    let restart: ReturnType<typeof setInterval> | null = null;
    const applyMessage = (message: Extract<FromWorker, { t: 'view' }>): void => {
      // Без подтверждения воркер перестаёт слать виды (защита от перегруза): партия замирала на первом кадре.
      match?.ack(message.seq);
      latest =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      if (layer === null) return;
      layer.setView(latest, EMPTY_SELECTION);
      layer.frame(performance.now());
    };
    const start = async (): Promise<void> => {
      const response = await fetch('/maps/small.json');
      const json: unknown = await response.json();
      const loaded = loadMap(json);
      const host = hostRef.current;
      if (disposed || !loaded.ok || host === null) return;
      const launch = (): void => {
        match?.dispose();
        if (slowDown !== null) clearTimeout(slowDown);
        deltaApplier = new ViewDeltaApplier();
        match = startLocalMatch(
          json,
          1 + Math.floor(Math.random() * 1_000_000),
          { count: BOTS, bots: Array.from({ length: BOTS }, (_, i) => i), speed: TIMELAPSE_SPEED },
          (message: FromWorker): void => {
            if (message.t === 'view') applyMessage(message);
          },
          { fog: false, playerColors: playerColorIds(color).slice(0, 2) },
        );
        slowDown = setTimeout(() => match?.setSpeed(BACKGROUND_SPEED), TIMELAPSE_MS);
      };
      launch();
      restart = setInterval(launch, RESTART_MS);
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
      if (latest !== null && layer !== null) {
        (layer as EconomyLayer).setView(latest, EMPTY_SELECTION);
        (layer as EconomyLayer).frame(performance.now());
      }
    };
    void start();
    return () => {
      disposed = true;
      if (glide !== null) clearInterval(glide);
      if (restart !== null) clearInterval(restart);
      if (slowDown !== null) clearTimeout(slowDown);
      stopResize?.();
      match?.dispose();
      layer?.destroy();
      mapView?.destroy();
    };
  }, [hostRef, color]);
}
