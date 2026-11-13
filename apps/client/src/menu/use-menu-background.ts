// Карта за меню: спокойная, без боёв. Пока открыт режим или комната, это карта, на которой будем
// играть: нажатие по ней выбирает место старта, а метки показывают столицы людей и ботов.
import { useEffect, useRef, useState, type RefObject } from 'react';

import { hexId, inBounds, loadMap, type MapStatic } from '@hexfront/sim';

import { createStartsLayer, type StartMarker, type StartsLayer } from './starts-layer.ts';
import { loadMapJson, type MapRequest } from '../local/map-request.ts';
import { mapBounds } from '../render/hex-geometry.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Не меньше этого масштаба: на нём видны рельеф и города. */
const WATCH_SCALE = 0.8;
/** Сдвиг мышью дальше этого (пикселей) — это перетаскивание карты, а не выбор места. */
const DRAG_PX = 6;
const FADE_MS = 400;

/** Что нарисовать на карте и что делать с нажатием по ней. */
export interface BackgroundStarts {
  readonly markers: readonly StartMarker[];
  /** Нажатие по гексу карты (id); `null` — нажатия ничего не выбирают. */
  readonly onPick: ((hex: number) => void) | null;
}

/**
 * Рисует карту запроса в `hostRef`.
 * @returns загруженная карта (для расчёта стартов) или `null`, пока она строится
 */
export function useMenuBackground(
  hostRef: RefObject<HTMLDivElement | null>,
  request: MapRequest,
  starts: BackgroundStarts,
): MapStatic | null {
  const { id, seed, size } = request;
  const [loaded, setLoaded] = useState<MapStatic | null>(null);
  const layerRef = useRef<StartsLayer | null>(null);
  const startsRef = useRef(starts);
  startsRef.current = starts;

  useEffect(() => {
    layerRef.current?.setMarkers(starts.markers);
  }, [starts.markers]);

  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let stopResize: (() => void) | null = null;
    let stopInput: (() => void) | null = null;
    setLoaded(null);

    const start = async (): Promise<void> => {
      const json = await loadMapJson({ id, seed, size, players: 6 });
      const result = loadMap(json);
      const host = hostRef.current;
      if (disposed || !result.ok || host === null) return;
      const { map } = result;
      host.style.transition = `opacity ${FADE_MS}ms ease`;
      host.style.opacity = '0';
      let dragged = false;
      const created = await createMapView(
        host,
        map,
        {
          radius: tokens.map.hexRadius,
          midLayer: (m, radius) => {
            const layer = createStartsLayer(m, radius, startsRef.current.markers);
            layerRef.current = layer;
            return layer;
          },
        },
        () => undefined,
        (hex) => {
          const pick = startsRef.current.onPick;
          if (dragged || pick === null || !inBounds(hex, map.width, map.height)) return;
          pick(hexId(hex, map.width));
        },
      );
      if (disposed) {
        created.destroy();
        return;
      }
      mapView = created;
      const bounds = mapBounds(map.width, map.height, tokens.map.hexRadius);
      const frame = (): void => {
        const cover = Math.max(host.clientWidth / bounds.width, host.clientHeight / bounds.height);
        created.setScale(Math.max(cover, WATCH_SCALE));
      };
      frame();
      const observer = new ResizeObserver(frame);
      observer.observe(host);
      stopResize = () => observer.disconnect();
      // Колесо и жесты пальцев карта разбирает сама; левой кнопкой мыши её тянем здесь.
      let travelled = 0;
      const onDown = (): void => {
        travelled = 0;
        dragged = false;
      };
      const onMove = (event: PointerEvent): void => {
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 1) {
          travelled += Math.abs(event.movementX) + Math.abs(event.movementY);
          if (travelled > DRAG_PX) dragged = true;
          created.pan(event.movementX, event.movementY);
        }
      };
      host.addEventListener('pointerdown', onDown, true);
      host.addEventListener('pointermove', onMove);
      stopInput = () => {
        host.removeEventListener('pointerdown', onDown, true);
        host.removeEventListener('pointermove', onMove);
      };
      const city = map.cities[Math.floor(map.cities.length / 2)];
      if (city !== undefined) created.centerOn({ q: city.q, r: city.r }, 0);
      layerRef.current?.setMarkers(startsRef.current.markers);
      host.style.opacity = '1';
      setLoaded(map);
    };
    void start();
    return () => {
      disposed = true;
      stopResize?.();
      stopInput?.();
      layerRef.current = null;
      mapView?.destroy();
    };
  }, [hostRef, id, seed, size]);

  return loaded;
}
