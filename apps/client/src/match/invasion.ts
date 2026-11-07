// Морское вторжение двумя нажатиями (03-cities-buildings.md, «Порты»): сначала порт, откуда
// отплыть (подсвечены все свои порты), затем гекс высадки (подсвечена любая чужая или ничья земля у
// воды; на гексе — цена в золоте, свой порт бесплатно). Армия снимается со старого приказа и
// получает новый — вторжение: идёт в порт, садится на корабли очередью и высаживается.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FP,
  TERRAIN,
  isPortOf,
  sailCost,
  seaTargets,
  type Command,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import type { EconomyLayer } from '../dev/economy-layer.ts';

export interface InvasionWorld {
  readonly view: PlayerView;
  readonly map: MapStatic;
}

export type InvasionStage = 'off' | 'from' | 'to';

export interface Invasion {
  readonly stage: InvasionStage;
  /** Армия, получающая приказ вторжения. */
  readonly armyId: number | null;
  start(armyId: number): void;
  cancel(): void;
  /** Нажатие по гексу в режиме вторжения; true — нажатие израсходовано. */
  clickHex(hex: number, send: (cmd: Command) => void): boolean;
}

/** Мир порта для sim-функций: карта, владельцы, здания и города снимка. */
function portGround(world: InvasionWorld) {
  return { map: world.map, hexes: world.view.hexes, cities: world.view.cities };
}

/** Война с игроком: без дипломатии в матче воюют все. */
function atWarWith(view: PlayerView, other: number): boolean {
  return (view.diplomacy?.relations[other] ?? 'war') === 'war';
}

/** Свои порты игрока в снимке: гексы, откуда можно отплыть. */
export function ownPorts(world: InvasionWorld): number[] {
  const g = portGround(world);
  const { view } = world;
  const out: number[] = [];
  view.hexes.owner.forEach((o, h) => {
    if (o === view.playerId && isPortOf(g, view.playerId, h)) out.push(h);
  });
  return out;
}

/** Отряды армии, которые поплывут. */
function armyUnits(view: PlayerView, armyId: number): UnitView[] {
  return view.units.filter(
    (u) => u.owner === view.playerId && u.armyId === armyId && !u.sea && u.order !== 'retreat',
  );
}

/**
 * Хук режима вторжения: состояние шагов, подсветка и подписи цены на карте.
 * @param world снимок и карта (null, пока матч не пришёл)
 */
export function useInvasion(
  layerRef: React.RefObject<EconomyLayer | null>,
  world: () => InvasionWorld | null,
): Invasion {
  const [stage, setStage] = useState<InvasionStage>('off');
  const [armyId, setArmyId] = useState<number | null>(null);
  const fromRef = useRef<number | null>(null);
  const targetsRef = useRef<Set<number>>(new Set());

  const clear = useCallback(() => {
    layerRef.current?.setMapMask(null, null);
    layerRef.current?.setHexLabels([]);
  }, [layerRef]);

  const cancel = useCallback(() => {
    fromRef.current = null;
    targetsRef.current = new Set();
    setStage('off');
    setArmyId(null);
    clear();
  }, [clear]);

  const showFrom = useCallback((): void => {
    const w = world();
    if (!w) return;
    const mask = new Uint8Array(w.view.hexes.owner.length);
    for (const p of ownPorts(w)) mask[p] = 1;
    layerRef.current?.setMapMask('build', mask);
    layerRef.current?.setHexLabels([]);
  }, [layerRef, world]);

  const showTo = useCallback(
    (army: number, from: number): void => {
      const w = world();
      if (!w) return;
      const { view, map } = w;
      const units = armyUnits(view, army);
      const g = portGround(w);
      const mask = new Uint8Array(view.hexes.owner.length);
      const labels: { hex: number; text: string }[] = [];
      const reachable = new Set<number>();
      for (const [hex, seaHexes] of seaTargets(map, from)) {
        if (map.terrain[hex] === TERRAIN.water) continue;
        const free = isPortOf(g, view.playerId, hex);
        // Своя земля, кроме портов, не цель вторжения: высаживаются на землю тех, с кем война, и на ничью.
        const owner = view.hexes.owner[hex] ?? -1;
        if (owner === view.playerId && !free) continue;
        if (owner >= 0 && owner !== view.playerId && !atWarWith(view, owner)) continue;
        const gold = sailCost(g, view.playerId, units, hex, seaHexes);
        mask[hex] = 1;
        labels.push({ hex, text: String(Math.ceil(gold / FP)) });
        reachable.add(hex);
      }
      targetsRef.current = reachable;
      layerRef.current?.setMapMask('build', mask);
      layerRef.current?.setHexLabels(labels);
    },
    [layerRef, world],
  );

  const start = useCallback(
    (id: number) => {
      cancel();
      setArmyId(id);
      setStage('from');
      showFrom();
    },
    [cancel, showFrom],
  );

  useEffect(() => {
    if (stage === 'off') return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, cancel]);

  const clickHex = useCallback(
    (hex: number, send: (cmd: Command) => void): boolean => {
      const w = world();
      if (stage === 'off' || armyId === null || !w) return false;
      if (stage === 'from') {
        if (!ownPorts(w).includes(hex)) return true;
        fromRef.current = hex;
        showTo(armyId, hex);
        setStage('to');
        return true;
      }
      const from = fromRef.current;
      if (from === null) return true;
      if (hex === from) {
        // Нажатие по порту отправки возвращает к выбору порта.
        fromRef.current = null;
        showFrom();
        setStage('from');
        return true;
      }
      if (!targetsRef.current.has(hex)) return true;
      send({ t: 'invade', armyId, from, to: hex });
      cancel();
      return true;
    },
    [stage, armyId, world, showFrom, showTo, cancel],
  );

  return { stage, armyId, start, cancel, clickHex };
}
