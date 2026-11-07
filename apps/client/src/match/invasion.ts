// Морское вторжение двумя нажатиями (03-cities-buildings.md, «Порты»): сначала порт, откуда отплыть
// (подсвечены только порты, где стоят отряды выбранной армии), затем гекс высадки (подсвечены те,
// куда можно приплыть; на гексе — цена). Свой порт — бесплатно, остальное — золото по числу солдат
// и длине пути по воде.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FP,
  TERRAIN,
  isPortOf,
  portCapacity,
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

export interface InvasionHint {
  readonly stage: InvasionStage;
  /** Ключ причины, по которой нажатие не принято или нельзя начать (reason.* / invade.*). */
  readonly error: string | null;
  /** Сколько солдат поплывёт и вместимость порта (для подписи шага «куда»). */
  readonly soldiers: number;
  readonly capacity: number;
}

export interface Invasion {
  readonly hint: InvasionHint;
  start(armyId: number): void;
  cancel(): void;
  /** Нажатие по гексу в режиме вторжения; true — нажатие израсходовано. */
  clickHex(hex: number, send: (cmd: Command) => void): boolean;
}

const OFF: InvasionHint = { stage: 'off', error: null, soldiers: 0, capacity: 0 };

/** Отряды армии в порту hex, которые могут отплыть. */
export function sailors(view: PlayerView, armyId: number, hex: number): UnitView[] {
  return view.units.filter(
    (u) =>
      u.owner === view.playerId &&
      u.armyId === armyId &&
      u.hex === hex &&
      !u.sea &&
      !u.inBattle &&
      u.order !== 'retreat',
  );
}

/** Порты игрока, в которых стоят отряды армии. */
export function armyPorts(world: InvasionWorld, armyId: number): number[] {
  const { view, map } = world;
  const g = { map, hexes: view.hexes };
  const ports = new Set<number>();
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId === armyId && isPortOf(g, view.playerId, u.hex)) {
      ports.add(u.hex);
    }
  }
  return [...ports].filter((p) => sailors(view, armyId, p).length > 0).sort((a, b) => a - b);
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
  const [error, setError] = useState<string | null>(null);
  const [soldiers, setSoldiers] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const armyRef = useRef<number | null>(null);
  const fromRef = useRef<number | null>(null);
  const targetsRef = useRef<Map<number, number>>(new Map());

  const clear = useCallback(() => {
    layerRef.current?.setMapMask(null, null);
    layerRef.current?.setHexLabels([]);
  }, [layerRef]);

  const cancel = useCallback(() => {
    armyRef.current = null;
    fromRef.current = null;
    targetsRef.current = new Map();
    setStage('off');
    setError(null);
    clear();
  }, [clear]);

  const showFrom = useCallback(
    (armyId: number): boolean => {
      const w = world();
      if (!w) return false;
      const ports = armyPorts(w, armyId);
      const mask = new Uint8Array(w.view.hexes.owner.length);
      for (const p of ports) mask[p] = 1;
      layerRef.current?.setMapMask('build', mask);
      layerRef.current?.setHexLabels([]);
      return ports.length > 0;
    },
    [layerRef, world],
  );

  const showTo = useCallback(
    (armyId: number, from: number): void => {
      const w = world();
      if (!w) return;
      const { view, map } = w;
      const units = sailors(view, armyId, from);
      const g = { map, hexes: view.hexes };
      const targets = seaTargets(map, from);
      const mask = new Uint8Array(view.hexes.owner.length);
      const labels: { hex: number; text: string }[] = [];
      const reachable = new Map<number, number>();
      for (const [hex, seaHexes] of targets) {
        if (hex === from) continue;
        const owner = view.hexes.owner[hex] ?? -1;
        if (
          owner >= 0 &&
          owner !== view.playerId &&
          (view.diplomacy?.relations[owner] ?? 'war') !== 'war'
        )
          continue;
        const free = isPortOf(g, view.playerId, hex);
        const gold = sailCost(g, view.playerId, units, hex, seaHexes);
        mask[hex] = free ? 1 : 2;
        labels.push({ hex, text: free ? '0' : String(Math.ceil(gold / FP)) });
        reachable.set(hex, seaHexes);
      }
      targetsRef.current = reachable;
      layerRef.current?.setMapMask('build', mask);
      layerRef.current?.setHexLabels(labels);
      setSoldiers(Math.floor(units.reduce((s, u) => s + u.soldiers, 0) / FP));
    },
    [layerRef, world],
  );

  const start = useCallback(
    (armyId: number) => {
      cancel();
      armyRef.current = armyId;
      if (showFrom(armyId)) {
        setStage('from');
        setError(null);
      } else {
        setStage('from');
        setError('invade.noPort');
      }
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
      const armyId = armyRef.current;
      const w = world();
      if (stage === 'off' || armyId === null || !w) return false;
      const { view, map } = w;
      if (stage === 'from') {
        if (!armyPorts(w, armyId).includes(hex)) {
          setError('invade.pickPort');
          return true;
        }
        fromRef.current = hex;
        const units = sailors(view, armyId, hex);
        setCapacity(Math.floor(portCapacity(view.hexes.building[hex] ?? 0) / FP));
        showTo(armyId, hex);
        setStage('to');
        setError(units.length === 0 ? 'invade.noPort' : null);
        return true;
      }
      const from = fromRef.current;
      if (from === null) return true;
      if (hex === from) {
        // Нажатие по порту отправки возвращает к выбору порта.
        fromRef.current = null;
        showFrom(armyId);
        setStage('from');
        setError(null);
        return true;
      }
      if (!targetsRef.current.has(hex) || map.terrain[hex] === TERRAIN.water) {
        setError('invade.pickTarget');
        return true;
      }
      const units = sailors(view, armyId, from);
      send({ t: 'sail', unitIds: units.map((u) => u.id), to: hex });
      cancel();
      return true;
    },
    [stage, world, showFrom, showTo, cancel],
  );

  const hint: InvasionHint = stage === 'off' ? OFF : { stage, error, soldiers, capacity };
  return { hint, start, cancel, clickHex };
}

/** Есть ли у армии отряды в портах: иначе кнопка вторжения серая. */
export function canInvade(view: PlayerView, map: MapStatic, armyId: number): boolean {
  return armyPorts({ view, map }, armyId).length > 0;
}
