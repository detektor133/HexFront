// Движок локального режима: матч sim, очередь команд игрока, снимок каждый тик.
// Живёт в Web Worker (sim-worker.ts); отдельно — чтобы тестироваться без браузера.
import {
  canFoundCity,
  checkConstruction,
  checkRecruit,
  FP,
  cityPopCap,
  hexPopCap,
  cityInfo,
  createMatch,
  loadMap,
  playerView,
  step,
  type Command,
  type Fp,
  type MatchState,
  type UnitType,
  type RejectReason,
} from '@hexfront/sim';

import type { FromWorker, RecruitOption, Selection } from './messages.ts';

/** В локальном режиме игрок-человек — всегда id 0; остальные ждут ботов (этап 05). */
export const HUMAN_ID = 0;

export interface LocalEngine {
  readonly state: MatchState;
  queue(cmd: Command): void;
  select(hex: number | null): void;
  /** Один тик симуляции; возвращает снимок для страницы. */
  tick(): FromWorker;
}

/** Размер набора кнопкой песочницы, солдат (временный интерфейс до ползунка 04/T8). */
const SANDBOX_RECRUIT = 100;
const RECRUIT_TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

function recruitOptions(state: MatchState, cityId: number): RecruitOption[] {
  const soldiers = (SANDBOX_RECRUIT * FP) as Fp;
  return RECRUIT_TYPES.map((type) => ({
    type,
    soldiers,
    check: checkRecruit(state, HUMAN_ID, cityId, type, soldiers),
  }));
}

function selectionOf(state: MatchState, hex: number): Selection {
  const city = state.cities.find((c) => c.hex === hex);
  return {
    hex,
    popCap: city ? cityPopCap(city.level) : hexPopCap(state, hex),
    city: city ? cityInfo(state, city.id) : null,
    foundCity: canFoundCity(state, HUMAN_ID, hex),
    improve: checkConstruction(state, HUMAN_ID, { t: 'improve', hex }),
    fort: checkConstruction(state, HUMAN_ID, { t: 'build', hex, kind: 'fort' }),
    depot: checkConstruction(state, HUMAN_ID, { t: 'build', hex, kind: 'depot' }),
    recruit: city?.owner === HUMAN_ID ? recruitOptions(state, city.id) : [],
  };
}

/**
 * Создаёт локальный матч из JSON карты.
 * @returns движок или список ошибок карты
 */
export function createLocalEngine(
  mapJson: unknown,
  seed: number,
  players: number,
): LocalEngine | { readonly errors: readonly string[] } {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) return { errors: loaded.errors };
  const setup = Array.from({ length: players }, (_, i) => ({ name: `P${i}` }));
  const state = createMatch(loaded.map, setup, seed);
  let pending: Command[] = [];
  let selected: number | null = null;
  return {
    state,
    queue(cmd) {
      pending.push(cmd);
    },
    select(hex) {
      selected = hex;
    },
    tick() {
      step(
        state,
        pending.map((cmd) => ({ playerId: HUMAN_ID, cmd })),
      );
      pending = [];
      const rejected: { command: string; reason: RejectReason }[] = [];
      for (const e of state.events) {
        if (e.t === 'commandRejected' && e.playerId === HUMAN_ID) {
          rejected.push({ command: e.command, reason: e.reason as RejectReason });
        }
      }
      return {
        t: 'view',
        view: playerView(state, HUMAN_ID),
        selection: selected === null ? null : selectionOf(state, selected),
        rejected,
      };
    },
  };
}
