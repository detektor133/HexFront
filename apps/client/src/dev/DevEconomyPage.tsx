import { useEffect, useRef, useState } from 'react';

import { hexFromId, hexId, inBounds, loadMap, type Command, type MapStatic } from '@hexfront/sim';

import styles from './DevEconomyPage.module.css';
import { HexCard } from './HexCard.tsx';
import { Hud } from './Hud.tsx';
import { createEconomyLayer, type EconomyLayer } from './economy-layer.ts';
import { t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Сид и число игроков отладочного матча: игрок и соперник без ботов (боты — этап 05). */
const SEED = 42;
const PLAYERS = 2;

function useMapJson(id: string): { json: unknown; map: MapStatic } | 'loading' | 'error' {
  const [state, setState] = useState<{ json: unknown; map: MapStatic } | 'loading' | 'error'>(
    'loading',
  );
  useEffect(() => {
    let alive = true;
    fetch(`/maps/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: unknown) => {
        const result = loadMap(json);
        if (!result.ok) throw new Error(result.errors.join('; '));
        if (alive) setState({ json, map: result.map });
      })
      .catch((error: unknown) => {
        console.error('dev_economy_map_failed', error);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

type ViewMessage = Extract<FromWorker, { t: 'view' }>;

/** Локальный матч + карта: запускает Web Worker и сцену Pixi, отдаёт последний снимок. */
function useLocalEconomy(
  hostRef: React.RefObject<HTMLDivElement | null>,
  loaded: ReturnType<typeof useMapJson>,
): {
  msg: ViewMessage | null;
  error: string | null;
  send: (cmd: Command) => void;
} {
  const matchRef = useRef<LocalMatch | null>(null);
  const layerRef = useRef<EconomyLayer | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof loaded === 'string') return;
    const { map, json } = loaded;
    let view: MapView | null = null;
    let cancelled = false;
    const match = startLocalMatch(json, SEED, PLAYERS, (m) => {
      if (m.t === 'error') return setError(m.errors.join('; '));
      layerRef.current?.setView(m.view, selectedRef.current);
      setMsg(m);
    });
    matchRef.current = match;
    // Параметры для скриншотов и отладки: сразу выбранный гекс и масштаб.
    const params = new URLSearchParams(window.location.search);
    const initialSelect = params.get('select');
    if (initialSelect !== null) {
      selectedRef.current = Number(initialSelect);
      match.select(selectedRef.current);
    }
    const initialScale = Number(params.get('scale'));
    const onTap = (h: { q: number; r: number }): void => {
      const id = inBounds(h, map.width, map.height) ? hexId(h, map.width) : null;
      selectedRef.current = id;
      match.select(id);
    };
    const options = {
      radius: tokens.map.hexRadius,
      midLayer: (m: MapStatic, radius: number) => {
        const layer = createEconomyLayer(m, radius);
        layerRef.current = layer;
        return layer;
      },
    };
    void createMapView(host, map, options, () => {}, onTap).then((v) => {
      if (cancelled) return v.destroy();
      view = v;
      if (initialScale > 0) v.setScale(initialScale);
      if (selectedRef.current !== null) v.centerOn(hexFromId(selectedRef.current, map.width));
    });
    return () => {
      cancelled = true;
      match.dispose();
      view?.destroy();
      matchRef.current = null;
      layerRef.current = null;
    };
  }, [hostRef, loaded]);

  return {
    msg,
    error,
    send: (cmd) => matchRef.current?.send(cmd),
  };
}

/** /dev/economy?map=small[&select=HexId&scale] — локальный матч (02/T10–T11). */
export function DevEconomyPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const loaded = useMapJson(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const { msg, error, send } = useLocalEconomy(hostRef, loaded);
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      {msg && <Hud view={msg.view} send={send} />}
      {(loaded === 'error' || error) && (
        <p className={styles.error}>{error ?? t('dev.map.error')}</p>
      )}
      {msg?.selection && typeof loaded !== 'string' && (
        <HexCard s={msg.selection} view={msg.view} map={loaded.map} send={send} />
      )}
    </div>
  );
}
