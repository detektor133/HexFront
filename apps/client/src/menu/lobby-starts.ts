// Столицы игроков комнаты для карты за меню: лобби кладёт их сюда, фон меню рисует метки, а нажатие
// по карте уходит обратно в лобби (оно владеет сетевым соединением).
import { useSyncExternalStore } from 'react';

export interface LobbyStarts {
  /** Столицы по номеру игрока (id гекса): сначала люди, затем боты. */
  readonly starts: readonly number[];
  /** Номер самого игрока и число людей в комнате. */
  readonly me: number;
  readonly humans: number;
  /** Выбрать столицу нажатием на карту; `null` — нельзя (зритель, нет связи). */
  readonly pick: ((hex: number) => void) | null;
}

const EMPTY: LobbyStarts = { starts: [], me: -1, humans: 0, pick: null };
let state: LobbyStarts = EMPTY;
const listeners = new Set<() => void>();

export const lobbyStarts = {
  set(next: LobbyStarts): void {
    state = next;
    for (const listener of listeners) listener();
  },
  clear(): void {
    if (state === EMPTY) return;
    state = EMPTY;
    for (const listener of listeners) listener();
  },
};

export function useLobbyStarts(): LobbyStarts {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
