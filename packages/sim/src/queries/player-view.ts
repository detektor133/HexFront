// Снимок состояния для игрока: то, что клиент получает 10 раз в секунду.
// Архитектура: sim-core.md — «Запросы». Туман войны — этап 04: сейчас видно всё.
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import { isCityIsolated } from '../state/network.ts';
import type { ConstructionKind, MatchState } from '../state/types.ts';
import { hexGrowthPerSecond } from '../systems/population.ts';

/** Связь узла сети: 0 — не узел, 1 — основная сеть, 2 — изолированная. */
export const LINK = { none: 0, main: 1, isolated: 2 } as const;

export interface PlayerView {
  readonly tick: number;
  readonly playerId: number;
  readonly hexes: {
    readonly owner: Int16Array;
    readonly pop: Int32Array;
    readonly improvement: Uint8Array;
    readonly building: Uint8Array;
    readonly road: Uint8Array;
    /** Коды LINK. */
    readonly link: Uint8Array;
    /** Отладка /dev/economy: людей в секунду (fixed-point), отрицательное — убыль. */
    readonly growth: Int32Array;
  };
  readonly cities: readonly {
    readonly id: number;
    readonly hex: HexId;
    readonly owner: number;
    readonly level: number;
    readonly name: string;
    readonly isCapital: boolean;
    readonly isolated: boolean;
  }[];
  readonly players: readonly {
    readonly id: number;
    readonly gold: Fp;
    readonly taxTarget: Fp;
    readonly taxEffective: Fp;
    readonly status: string;
  }[];
  readonly constructions: readonly {
    readonly id: number;
    readonly owner: number;
    readonly hex: HexId;
    readonly kind: ConstructionKind;
    readonly progressTicks: number;
    readonly totalTicks: number;
    readonly path: readonly HexId[];
  }[];
}

function links(state: MatchState): Uint8Array {
  const main = new Set(state.networks.filter((n) => n.isMain).map((n) => n.id));
  return Uint8Array.from(state.hexes.network, (id) =>
    id < 0 ? LINK.none : main.has(id) ? LINK.main : LINK.isolated,
  );
}

/**
 * Снимок для игрока. Массивы — копии: клиент может их менять, состояние не пострадает.
 * @returns данные для отрисовки и интерфейса
 */
export function playerView(state: MatchState, playerId: number): PlayerView {
  const { hexes } = state;
  return {
    tick: state.tick,
    playerId,
    hexes: {
      owner: Int16Array.from(hexes.owner),
      pop: Int32Array.from(hexes.pop),
      improvement: Uint8Array.from(hexes.improvement),
      building: Uint8Array.from(hexes.building),
      road: Uint8Array.from(hexes.road),
      link: links(state),
      growth: Int32Array.from(hexes.pop, (_, id) => hexGrowthPerSecond(state, id)),
    },
    cities: state.cities.map((c) => ({
      id: c.id,
      hex: c.hex,
      owner: c.owner,
      level: c.level,
      name: c.name,
      isCapital: state.players[c.owner]?.capitalCityId === c.id,
      isolated: isCityIsolated(state, c.id),
    })),
    players: state.players.map((p) => ({
      id: p.id,
      gold: p.gold,
      taxTarget: p.taxTarget,
      taxEffective: p.taxEffective,
      status: p.status,
    })),
    constructions: state.constructions.map((c) => ({
      id: c.id,
      owner: c.owner,
      hex: c.hex,
      kind: c.kind,
      progressTicks: c.progressTicks,
      totalTicks: c.totalTicks,
      path: [...(c.path ?? [])],
    })),
  };
}
