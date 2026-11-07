// Режимы карты: карта снабжения и режим строительства (молоточек). Маска по гексам считается в
// воркере (sim знает, где можно строить и как снабжён гекс), страница запрашивает её раз в секунду,
// пока режим включён, и сразу после стройки.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SUPPLY_REBUILD_COST_PER_HEX,
  planRoadRoute,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import type { EconomyLayer } from '../dev/economy-layer.ts';
import type { LocalMatch } from '../local/local-match.ts';
import type { MapMaskMode, MapMaskReply } from '../local/messages.ts';

export type MapMode = 'normal' | 'supply';
export type BuildTool = 'city' | 'fort' | 'depot' | 'improve' | 'road';

/** Что нужно клику по гексу для дороги вручную: мир игрока и показ маршрута на карте. */
export interface RoadContext {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly preview: (path: readonly number[] | null) => void;
}

/** Дорога вручную: сколько точек задано и сколько стоит текущий маршрут (fixed-point золота). */
export interface RoadInfo {
  readonly points: number;
  readonly cost: number | null;
}

/** Как часто обновляется маска, мс: стройка и захват гексов меняют её не чаще секунды. */
const REFRESH_MS = 1000;
/** Пауза после команды стройки: команда применяется на ближайшем тике (100 мс). */
const AFTER_COMMAND_MS = 250;

/** Команда стройки выбранного здания на гексе. */
export function buildCommand(tool: BuildTool, hex: number): Command {
  switch (tool) {
    case 'city':
      return { t: 'foundCity', hex };
    case 'improve':
      return { t: 'improve', hex };
    case 'road':
      return { t: 'buildRoad', points: [hex, hex] };
    default:
      return { t: 'build', hex, kind: tool };
  }
}

function modeOf(mapMode: MapMode, build: BuildTool | null): MapMaskMode | null {
  // У дороги вручную маски нет: она ведётся по точкам, а не по подсвеченным гексам.
  if (build === 'road') return null;
  if (build) return `build:${build}`;
  return mapMode === 'supply' ? 'supply' : null;
}

/** Итог клика по гексу в режиме строительства: стройка пошла, не хватает золота или нельзя. */
export interface BuildFeedback {
  readonly id: number;
  readonly kind: 'ok' | 'gold' | 'blocked';
  /** Точка клика, px страницы. */
  readonly x: number;
  readonly y: number;
}

export interface MapModes {
  /** Последний клик строительства для анимации; гаснет сам. */
  readonly feedback: BuildFeedback | null;
  readonly mapMode: MapMode;
  readonly build: BuildTool | null;
  /** Состояние дороги вручную (пока выбран инструмент «Дорога»). */
  readonly road: RoadInfo;
  setMapMode(mode: MapMode): void;
  setBuild(tool: BuildTool | null): void;
  /** Обрабатывает ответ воркера с маской режима карты. */
  handleReply(reply: MapMaskReply): void;
  /**
   * Клик по гексу в режиме строительства.
   * @returns true, если режим включён и клик израсходован (строится, если гекс подсвечен)
   */
  clickHex(
    hex: number,
    send: (cmd: Command) => void,
    at?: { readonly x: number; readonly y: number },
    road?: RoadContext,
  ): boolean;
}

export function useMapModes(
  matchRef: React.RefObject<LocalMatch | null>,
  layerRef: React.RefObject<EconomyLayer | null>,
): MapModes {
  const [mapMode, setMapModeState] = useState<MapMode>('normal');
  const [build, setBuildState] = useState<BuildTool | null>(null);
  const modeRef = useRef<MapMaskMode | null>(null);
  const buildRef = useRef<BuildTool | null>(null);
  const maskRef = useRef<Uint8Array>(new Uint8Array(0));
  const requestId = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const [feedback, setFeedback] = useState<BuildFeedback | null>(null);
  const roadPoints = useRef<number[]>([]);
  const roadPreview = useRef<RoadContext['preview'] | null>(null);
  const [road, setRoad] = useState<RoadInfo>({ points: 0, cost: null });
  const feedbackId = useRef(0);

  const request = useCallback(() => {
    const mode = modeRef.current;
    if (mode === null) return;
    requestId.current += 1;
    matchRef.current?.requestMask?.(requestId.current, mode);
  }, [matchRef]);

  useEffect(() => {
    const mode = modeOf(mapMode, build);
    modeRef.current = mode;
    buildRef.current = build;
    maskRef.current = new Uint8Array(0);
    // Смена инструмента или выход из режима сбрасывает набранные точки дороги и её показ на карте.
    roadPoints.current = [];
    setRoad({ points: 0, cost: null });
    roadPreview.current?.(null);
    if (mode === null) {
      layerRef.current?.setMapMask(null, null);
      return;
    }
    request();
    const timer = window.setInterval(request, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [mapMode, build, request, layerRef]);

  // Esc выходит из режима строительства.
  useEffect(() => {
    if (build === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setBuildState(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [build]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const handleReply = useCallback(
    (reply: MapMaskReply): void => {
      // Ответ на уже выключенный или сменённый режим игнорируется.
      if (reply.mode !== modeRef.current) return;
      maskRef.current = reply.mask;
      layerRef.current?.setMapMask(reply.mode === 'supply' ? 'supply' : 'build', reply.mask);
    },
    [layerRef],
  );

  const clickHex = useCallback(
    (
      hex: number,
      send: (cmd: Command) => void,
      at?: { readonly x: number; readonly y: number },
      roadContext?: RoadContext,
    ): boolean => {
      const tool = buildRef.current;
      if (tool === null) return false;
      if (tool === 'road') {
        if (!roadContext) return true;
        roadPreview.current = roadContext.preview;
        const points = roadPoints.current;
        const last = points.at(-1);
        // Повторный клик по последней точке проводит дорогу, по первой единственной — сбрасывает.
        if (last === hex) {
          if (points.length >= 2) {
            send({ t: 'buildRoad', points: [...points] });
            roadPoints.current = [];
            roadContext.preview(null);
            setRoad({ points: 0, cost: null });
          } else {
            roadPoints.current = [];
            setRoad({ points: 0, cost: null });
          }
          return true;
        }
        const next = [...points, hex];
        let cost: number | null = null;
        let ok = true;
        if (next.length >= 2) {
          const route = planRoadRoute(
            { map: roadContext.map, hexes: roadContext.view.hexes },
            roadContext.view.playerId,
            next,
            new Set(roadContext.view.cities.map((c) => c.hex)),
          );
          ok = route.ok || route.reason === 'alreadyBuilt';
          if (route.ok) {
            cost = SUPPLY_REBUILD_COST_PER_HEX * route.toBuild.length;
            roadContext.preview(route.path);
          }
        } else if (roadContext.view.hexes.owner[hex] !== roadContext.view.playerId) {
          ok = false;
        }
        if (ok) {
          roadPoints.current = next;
          setRoad({ points: next.length, cost });
        }
        if (at) {
          feedbackId.current += 1;
          setFeedback({ id: feedbackId.current, kind: ok ? 'ok' : 'blocked', x: at.x, y: at.y });
        }
        return true;
      }
      // 1 — можно построить; 2 — не хватает золота, 0 — нельзя: клик объясняет отказ.
      const mask = maskRef.current[hex];
      if (at) {
        feedbackId.current += 1;
        const kind = mask === 1 ? 'ok' : mask === 2 ? 'gold' : 'blocked';
        setFeedback({ id: feedbackId.current, kind, x: at.x, y: at.y });
      }
      if (mask === 1) {
        send(buildCommand(tool, hex));
        if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(request, AFTER_COMMAND_MS);
      }
      return true;
    },
    [request],
  );

  return {
    feedback,
    mapMode,
    build,
    road,
    setMapMode: (mode) => {
      setMapModeState(mode);
      setBuildState(null);
    },
    setBuild: (tool) => setBuildState(tool),
    handleReply,
    clickHex,
  };
}
