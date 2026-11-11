// Живая карта за меню и лобби: боты играют на малой карте, камера закрывает весь экран, а не
// вписывает карту целиком (на телефоне вписанная карта — узкая полоса посередине).
import { useEffect, type RefObject } from 'react';

import { loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { mapBounds } from '../render/hex-geometry.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;

/** Боты на фоне идут быстрее обычного: на экране меню должно что-то происходить. */
const BACKGROUND_SPEED = 3;

/** Запускает фоновый матч ботов и рисует его в `hostRef`; цвет — основной цвет игрока. */
export function useMenuBackground(hostRef: RefObject<HTMLDivElement | null>, color: string): void {
  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let stopResize: (() => void) | null = null;
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
    const match: LocalMatch = startLocalMatch(
      'small',
      1,
      { count: 6, bots: [0, 1, 2, 3, 4, 5], speed: BACKGROUND_SPEED },
      (message: FromWorker): void => {
        if (message.t === 'view') applyMessage(message);
      },
      { fog: false, playerColors: playerColorIds(color).slice(0, 2) },
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
      // Меню закрыли, пока холст готовился (быстрое «Играть»): отдать его сразу, иначе он останется
      // в памяти вместе с контекстом WebGL.
      if (disposed) {
        created.destroy();
        return;
      }
      mapView = created;
      const bounds = mapBounds(loaded.map.width, loaded.map.height, tokens.map.hexRadius);
      const cover = (): void => {
        const scale = Math.max(host.clientWidth / bounds.width, host.clientHeight / bounds.height);
        created.setScale(scale);
      };
      cover();
      const observer = new ResizeObserver(cover);
      observer.observe(host);
      stopResize = () => observer.disconnect();
      if (pendingMessage !== null) applyMessage(pendingMessage);
    };
    void start();
    return () => {
      disposed = true;
      stopResize?.();
      match.dispose();
      layer?.destroy();
      mapView?.destroy();
    };
  }, [hostRef, color]);
}
