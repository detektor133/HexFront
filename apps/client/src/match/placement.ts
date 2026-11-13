// Выбор места старта в начале матча: игрок нажимает на любое место карты, игра находит ближайшую
// стартовую точку. Сами точки не показываются, боты садятся случайно. Общее хранилище вне React:
// им пользуются сеть, карта и панель.
import { useSyncExternalStore } from 'react';

export interface PlacementState {
  /** Идёт ли выбор. */
  readonly active: boolean;
  /** Выбранная точка старта (индекс в карте); `null` — не выбрана или «случайно». */
  readonly spawn: number | null;
  /** Время конца выбора по часам страницы, мс; `null` — без срока (игра с ботами). */
  readonly endsAt: number | null;
  /** Игрок уже решил (выбрал место или «Случайно»), ждёт остальных. */
  readonly decided: boolean;
  /** Нужна кнопка «Начать» (игра с ботами); в сети выбор засчитывается сразу. */
  readonly canConfirm: boolean;
}

const OFF: PlacementState = {
  active: false,
  spawn: null,
  endsAt: null,
  decided: false,
  canConfirm: false,
};
const listeners = new Set<() => void>();
let state: PlacementState = OFF;

/** Действия, которые сеть или страница подставляют на время выбора. */
export interface PlacementActions {
  /** Игрок выбрал точку (`null` — «случайно»). */
  readonly choose: (spawn: number | null) => void;
  /** «Начать» (игра с ботами) — подтвердить выбор. */
  readonly confirm?: () => void;
}
let actions: PlacementActions | null = null;

function set(next: PlacementState): void {
  state = next;
  for (const listener of listeners) listener();
}

export const placement = {
  getState: (): PlacementState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  begin: (endsAt: number | null, with_: PlacementActions): void => {
    actions = with_;
    set({
      active: true,
      spawn: null,
      endsAt,
      decided: false,
      canConfirm: with_.confirm !== undefined,
    });
  },
  /** Сервер подтвердил выбор (или назначил ближайшую свободную точку). */
  update: (patch: Partial<Pick<PlacementState, 'spawn' | 'decided' | 'endsAt'>>): void => {
    if (state.active) set({ ...state, ...patch });
  },
  end: (): void => {
    actions = null;
    set(OFF);
  },
  /** Нажатие по карте: ближайшая стартовая точка. */
  tap: (spawn: number | null): void => {
    if (!state.active) return;
    set({ ...state, spawn, decided: !state.canConfirm });
    actions?.choose(spawn);
  },
  confirm: (): void => actions?.confirm?.(),
};

export function usePlacement(): PlacementState {
  return useSyncExternalStore(placement.subscribe, placement.getState, placement.getState);
}

/** Расстояние между гексами в осевых координатах. */
function steps(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Индекс ближайшей к `hex` стартовой точки карты. */
export function nearestSpawn(
  spawns: readonly { readonly q: number; readonly r: number }[],
  hex: { readonly q: number; readonly r: number },
): number | null {
  let best: number | null = null;
  let bestSteps = Infinity;
  spawns.forEach((spawn, index) => {
    const distance = steps(spawn, hex);
    if (distance < bestSteps) {
      best = index;
      bestSteps = distance;
    }
  });
  return best;
}
