// Режимы карты: карта снабжения и режим строительства (молоточек). Маска по гексам считается в
// воркере (sim знает, где можно строить и как снабжён гекс), страница запрашивает её раз в секунду,
// пока режим включён, и сразу после стройки.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Command } from '@hexfront/sim';

import type { EconomyLayer } from '../dev/economy-layer.ts';
import type { LocalMatch } from '../local/local-match.ts';
import type { MapMaskMode, MapMaskReply } from '../local/messages.ts';

export type MapMode = 'normal' | 'supply';
export type BuildTool = 'city' | 'fort' | 'depot' | 'improve';

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
    default:
      return { t: 'build', hex, kind: tool };
  }
}

function modeOf(mapMode: MapMode, build: BuildTool | null): MapMaskMode | null {
  if (build) return `build:${build}`;
  return mapMode === 'supply' ? 'supply' : null;
}

export interface MapModes {
  readonly mapMode: MapMode;
  readonly build: BuildTool | null;
  setMapMode(mode: MapMode): void;
  setBuild(tool: BuildTool | null): void;
  /** Обрабатывает ответ воркера с маской режима карты. */
  handleReply(reply: MapMaskReply): void;
  /**
   * Клик по гексу в режиме строительства.
   * @returns true, если режим включён и клик израсходован (строится, если гекс подсвечен)
   */
  clickHex(hex: number, send: (cmd: Command) => void): boolean;
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
    (hex: number, send: (cmd: Command) => void): boolean => {
      const tool = buildRef.current;
      if (tool === null) return false;
      // 1 — можно построить; 2 — не хватает золота, 0 — нельзя: клик ничего не делает.
      if (maskRef.current[hex] === 1) {
        send(buildCommand(tool, hex));
        if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(request, AFTER_COMMAND_MS);
      }
      return true;
    },
    [request],
  );

  return {
    mapMode,
    build,
    setMapMode: (mode) => {
      setMapModeState(mode);
      setBuildState(null);
    },
    setBuild: (tool) => setBuildState(tool),
    handleReply,
    clickHex,
  };
}
