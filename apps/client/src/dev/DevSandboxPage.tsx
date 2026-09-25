import { useCallback, useEffect, useRef, useState } from 'react';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { ArmiesPanel } from './ArmiesPanel.tsx';
import styles from './DevSandboxPage.module.css';
import { HexCard } from './HexCard.tsx';
import { Hud } from './Hud.tsx';
import { UnitCard } from './UnitCard.tsx';
import { createEconomyLayer, type EconomyLayer } from './economy-layer.ts';
import { NOTHING_PICKED, tapHex, type Picked } from './sandbox-selection.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Сид и число игроков: игрок и соперник без ботов (боты — этап 05). */
const SEED = 42;
const PLAYERS = 2;

type Loaded = { json: unknown; map: MapStatic } | 'loading' | 'error';

function useMapJson(id: string): Loaded {
  const [state, setState] = useState<Loaded>('loading');
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
        console.error('dev_sandbox_map_failed', error);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

type ViewMessage = Extract<FromWorker, { t: 'view' }>;

interface Sandbox {
  readonly msg: ViewMessage | null;
  readonly error: string | null;
  readonly picked: Picked;
  readonly lastReject: string | null;
  send(cmd: Command): void;
  pick(p: Picked): void;
}

/** Локальный матч + карта: Web Worker, сцена Pixi, выбор и приказы кликом. */
function useSandbox(hostRef: React.RefObject<HTMLDivElement | null>, loaded: Loaded): Sandbox {
  const matchRef = useRef<LocalMatch | null>(null);
  const layerRef = useRef<EconomyLayer | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const pickedRef = useRef<Picked>(NOTHING_PICKED);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const [lastReject, setLastReject] = useState<string | null>(null);

  const pick = useCallback((p: Picked) => {
    if (p.hex !== pickedRef.current.hex) matchRef.current?.select(p.hex);
    pickedRef.current = p;
    setPicked(p);
    if (viewRef.current) layerRef.current?.setView(viewRef.current, p);
  }, []);
  const send = useCallback((cmd: Command) => matchRef.current?.send(cmd), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof loaded === 'string') return;
    const { map, json } = loaded;
    let view: MapView | null = null;
    let cancelled = false;
    const match = startLocalMatch(json, SEED, PLAYERS, (m) => {
      if (m.t === 'error') return setError(m.errors.join('; '));
      viewRef.current = m.view;
      layerRef.current?.setView(m.view, pickedRef.current);
      setMsg(m);
      const last = m.rejected.at(-1);
      if (last) setLastReject(reasonText(last.reason));
    });
    matchRef.current = match;
    // Параметры для скриншотов и отладки: сразу выбранный гекс и масштаб.
    const params = new URLSearchParams(window.location.search);
    const initialSelect = params.get('select');
    if (initialSelect !== null) pick({ hex: Number(initialSelect), units: [], target: null });
    const initialScale = Number(params.get('scale'));
    const onTap = (h: { q: number; r: number }): void => {
      const current = viewRef.current;
      if (!current || !inBounds(h, map.width, map.height)) return pick(NOTHING_PICKED);
      const next = tapHex(current, pickedRef.current, hexId(h, map.width));
      if (next.cmd) match.send(next.cmd);
      pick(next.picked);
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
      const hex = pickedRef.current.hex;
      if (hex !== null) v.centerOn(hexFromId(hex, map.width));
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') pick(NOTHING_PICKED);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      match.dispose();
      view?.destroy();
      matchRef.current = null;
      layerRef.current = null;
    };
  }, [hostRef, loaded, pick]);

  return { msg, error, picked, lastReject, send, pick };
}

/** /dev/sandbox?map=small[&select=HexId&scale] — песочница: экономика, отряды, бой (03/T12). */
export function DevSandboxPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const loaded = useMapJson(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const sb = useSandbox(hostRef, loaded);
  const map = typeof loaded === 'string' ? null : loaded.map;
  const view = sb.msg?.view;
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      {view && <Hud view={view} send={sb.send} />}
      {view && <ArmiesPanel view={view} send={sb.send} onPick={sb.pick} />}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {view && map && sb.picked.units.length > 0 && (
        <UnitCard view={view} map={map} picked={sb.picked} send={sb.send} onPick={sb.pick} />
      )}
      {view && map && sb.picked.units.length === 0 && sb.msg?.selection && (
        <HexCard s={sb.msg.selection} view={view} map={map} send={sb.send} />
      )}
      {sb.lastReject && (
        <p className={styles.reject}>
          {t('dev.economy.lastRejection')}: {sb.lastReject}
        </p>
      )}
    </div>
  );
}
