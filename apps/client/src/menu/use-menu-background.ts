// Живая карта за меню: боты играют на малой карте, камера закрывает весь экран (на телефоне
// вписанная карта — узкая полоса). Меню получает управление камерой для «провала» в город.
import { useEffect, useRef, useState, type RefObject } from 'react';

import { loadMap, type MapStatic } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { startLocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { hexCenter, mapBounds } from '../render/hex-geometry.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;
const BACKGROUND_SPEED = 2;

export interface MenuMapApi {
  readonly map: MapStatic;
  /** Экранная точка (px от левого верха холста) города карты; `null` — вне экрана. */
  screenOf(q: number, r: number): { readonly x: number; readonly y: number } | null;
  /** Плавно приближает камеру к гексу; `bottomInset` смещает центр кадра вверх. */
  flyTo(q: number, r: number, zoom: number, bottomInset: number): void;
  /** Возвращает камеру на весь экран. */
  home(): void;
  /** Подписка на сдвиг камеры (плашки идут за картой). */
  onCamera(listener: () => void): () => void;
}

function ease(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Запускает фоновый матч и рисует его в `hostRef`; возвращает API камеры, когда карта готова. */
export function useMenuBackground(
  hostRef: RefObject<HTMLDivElement | null>,
  color: string,
): MenuMapApi | null {
  const [api, setApi] = useState<MenuMapApi | null>(null);
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let stopResize: (() => void) | null = null;
    let raf = 0;
    let pendingMessage: Extract<FromWorker, { t: 'view' }> | null = null;
    const deltaApplier = new ViewDeltaApplier();
    const applyMessage = (message: Extract<FromWorker, { t: 'view' }>): void => {
      if (layer === null) {
        pendingMessage = message;
        return;
      }
      const view =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      layer.setView(view, EMPTY_SELECTION);
      layer.frame(performance.now());
    };
    const match = startLocalMatch(
      'small',
      1,
      { count: 6, bots: [0, 1, 2, 3, 4, 5], speed: BACKGROUND_SPEED },
      (message: FromWorker): void => {
        if (message.t === 'view') applyMessage(message);
      },
      { fog: false, playerColors: playerColorIds(colorRef.current).slice(0, 2) },
    );
    const start = async (): Promise<void> => {
      const response = await fetch('/maps/small.json');
      const json: unknown = await response.json();
      const loaded = loadMap(json);
      const host = hostRef.current;
      if (disposed || !loaded.ok || host === null) return;
      const created = await createMapView(
        host,
        loaded.map,
        {
          radius: tokens.map.hexRadius,
          midLayer: (map, radius) => {
            layer = createEconomyLayer(map, radius);
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
      let coverScale = 1;
      let scale = 1;
      const cover = (): void => {
        coverScale = Math.max(host.clientWidth / bounds.width, host.clientHeight / bounds.height);
        if (!flying) {
          scale = coverScale;
          created.setScale(coverScale);
        }
      };
      let flying = false;
      cover();
      const observer = new ResizeObserver(cover);
      observer.observe(host);
      stopResize = () => observer.disconnect();
      const animateScale = (to: number, ms: number): void => {
        cancelAnimationFrame(raf);
        const from = scale;
        const began = performance.now();
        flying = true;
        const step = (now: number): void => {
          const k = Math.min(1, (now - began) / ms);
          scale = from + (to - from) * ease(k);
          created.setScale(scale);
          if (k < 1) raf = requestAnimationFrame(step);
          else flying = false;
        };
        raf = requestAnimationFrame(step);
      };
      setApi({
        map: loaded.map,
        screenOf(q, r) {
          const rect = created.visibleWorldRect?.();
          if (rect === undefined) return null;
          const world = hexCenter({ q, r }, tokens.map.hexRadius);
          const w = rect.to.x - rect.from.x;
          const h = rect.to.y - rect.from.y;
          return {
            x: ((world.x - rect.from.x) / w) * host.clientWidth,
            y: ((world.y - rect.from.y) / h) * host.clientHeight,
          };
        },
        flyTo(q, r, zoom, bottomInset) {
          created.setBottomInset(bottomInset);
          created.centerOn({ q, r }, 700);
          animateScale(coverScale * zoom, 700);
        },
        home() {
          created.setBottomInset(0);
          animateScale(coverScale, 600);
        },
        onCamera: (listener) => created.onCamera(listener),
      });
      if (pendingMessage !== null) applyMessage(pendingMessage);
    };
    void start();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      stopResize?.();
      match.dispose();
      layer?.destroy();
      mapView?.destroy();
      setApi(null);
    };
  }, [hostRef, color]);

  return api;
}
