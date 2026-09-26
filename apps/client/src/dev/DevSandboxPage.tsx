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
import { ChipSwitch } from './ChipSwitch.tsx';
import styles from './DevSandboxPage.module.css';
import { HexCard } from './HexCard.tsx';
import { Hud } from './Hud.tsx';
import { UnitCard } from './UnitCard.tsx';
import { createEconomyLayer, type EconomyLayer } from './economy-layer.ts';
import type { Draft, DraftContext } from './plan-draft.ts';
import { createPlanInput, type ToolState } from './plan-tools.ts';
import { NOTHING_PICKED, orderHex, selectHex, type Picked } from './sandbox-selection.ts';
import { CHIP_STYLES, type ChipStyle } from './unit-chips.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import type { Point } from '../render/hex-geometry.ts';
import { createMapView, type MapView, type TapKind } from '../render/map-view.ts';
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
  readonly tool: ToolState | null;
  readonly army: number | null;
  readonly chipStyle: ChipStyle;
  send(cmd: Command): void;
  pick(p: Picked): void;
  setTool(t: ToolState | null): void;
  setArmy(id: number | null): void;
  setChipStyle(s: ChipStyle): void;
}

/** Ключ localStorage выбранного вида фишки — удобство одного зрителя (CR-003). */
const CHIP_KEY = 'hexfront.chipStyle';

function savedChipStyle(): ChipStyle {
  try {
    const v = window.localStorage.getItem(CHIP_KEY);
    return CHIP_STYLES.find((s) => s === v) ?? 'hoi';
  } catch (error) {
    console.warn('chip_style_read_failed', error);
    return 'hoi';
  }
}

/** Локальный матч + карта: Web Worker, сцена Pixi, выбор и приказы кликом. */
function useSandbox(hostRef: React.RefObject<HTMLDivElement | null>, loaded: Loaded): Sandbox {
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
  const [chipStyle, setChipStyleState] = useState<ChipStyle>(savedChipStyle);
  const chipRef = useRef(chipStyle);
  const setChipStyle = useCallback((s: ChipStyle) => {
    chipRef.current = s;
    setChipStyleState(s);
    layerRef.current?.setChipStyle(s);
    try {
      window.localStorage.setItem(CHIP_KEY, s);
    } catch (error) {
      console.warn('chip_style_write_failed', error);
    }
  }, []);

  const pick = useCallback((p: Picked) => {
    if (p.hex !== pickedRef.current.hex) matchRef.current?.select(p.hex);
    pickedRef.current = p;
    setPicked(p);
    if (viewRef.current) layerRef.current?.setView(viewRef.current, p);
  }, []);
  const send = useCallback((cmd: Command) => matchRef.current?.send(cmd), []);
  const setArmy = useCallback((id: number | null) => {
    armyRef.current = id;
    setArmyState(id);
    layerRef.current?.setSelectedArmy(id);
  }, []);
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
    const onTap = (h: { q: number; r: number }, kind: TapKind, world: Point): void => {
      const current = viewRef.current;
      if (!current || !inBounds(h, map.width, map.height)) {
        return toolRef.current ? undefined : pick(NOTHING_PICKED);
      }
      const hex = hexId(h, map.width);
      if (input.tap(world, kind)) return;
      if (kind === 'select') return pick(selectHex(current, pickedRef.current, hex));
      const next = orderHex(current, pickedRef.current, hex);
      if (next.cmd) match.send(next.cmd);
      pick(next.picked);
    };
    const options = {
      radius: tokens.map.hexRadius,
      midLayer: (m: MapStatic, radius: number) => {
        const layer = createEconomyLayer(m, radius);
        layer.setChipStyle(chipRef.current);
        layer.setSelectedArmy(armyRef.current);
        layerRef.current = layer;
        return layer;
      },
    };
    void createMapView(host, map, options, () => {}, onTap).then((v) => {
      if (cancelled) return v.destroy();
      view = v;
      mapViewRef.current = v;
      v.setGrab(input.grab);
      if (initialScale > 0) v.setScale(initialScale);
      const hex = pickedRef.current.hex;
      if (hex !== null) v.centerOn(hexFromId(hex, map.width));
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (toolRef.current) setTool(null);
      else pick(NOTHING_PICKED);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      match.dispose();
      view?.destroy();
      matchRef.current = null;
      layerRef.current = null;
      mapViewRef.current = null;
    };
  }, [hostRef, loaded, pick, input, setTool]);

  return {
    msg,
    error,
    picked,
    lastReject,
    tool,
    army,
    chipStyle,
    send,
    pick,
    setTool,
    setArmy,
    setChipStyle,
  };
}

/** /dev/sandbox?map=small[&select=HexId&scale] — песочница: экономика, отряды, бой (03/T12). */
export function DevSandboxPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const loaded = useMapJson(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const sb = useSandbox(hostRef, loaded);
  const { army } = sb;
  const view = sb.msg?.view;
  // Выбрана армия целиком — её сводка в нижней панели, карточка отряда не нужна (как в HoI4).
  const armyUnits = view?.units.filter((u) => u.armyId !== null && u.armyId === army) ?? [];
  const armyPicked =
    armyUnits.length > 0 &&
    armyUnits.length === sb.picked.units.length &&
    armyUnits.every((u) => sb.picked.units.includes(u.id));
  const map = typeof loaded === 'string' ? null : loaded.map;
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      {view && <Hud view={view} send={sb.send} />}
      {view && <ChipSwitch value={sb.chipStyle} onChange={sb.setChipStyle} />}
      {view && (
        <ArmyBar
          view={view}
          selected={view.armies.some((a) => a.id === army) ? army : null}
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
