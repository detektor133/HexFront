// Движок локального режима: матч sim, очередь команд игрока, снимок каждый тик.
// Живёт в Web Worker (sim-worker.ts); отдельно — чтобы тестироваться без браузера.
import {
  canFoundCity,
  checkConstruction,
  checkRecruit,
  COST_POP_PER_SOLDIER,
  RECRUIT_MIN,
  RECRUIT_STEP,
  fpDiv,
  recruitCapacity,
  cityPopCap,
  hexPopCap,
  botCommands,
  cityInfo,
  commanderCommands,
  createMatch,
  createPlayerViewContext,
  loadMap,
  playerView,
  step,
  type Command,
  type Fp,
  type MatchState,
  type UnitType,
  type RejectReason,
} from '@hexfront/sim';

import type { RecruitOption, Selection, ViewPayload } from './messages.ts';

/**
 * В локальном режиме игрок-человек — всегда id 0; армиями с auto у всех командует commander,
 * экономикой ботов — мозг бота (09-bots.md).
 */
export const HUMAN_ID = 0;

export interface LocalEngine {
  readonly state: MatchState;
  queue(cmd: Command): void;
  setFog(on: boolean): void;
  setObserver(playerId: number | null): void;
  select(hex: number | null): void;
  /** Один тик симуляции; возвращает снимок для страницы. */
  tick(): ViewPayload;
  /** Возвращает накопленный снимок без продвижения симуляции. */
  snapshot(): ViewPayload;
  /** Продвигает один тик без построения снимка. */
  advance(): void;
}

const RECRUIT_TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

function recruitOptions(state: MatchState, cityId: number): RecruitOption[] {
  return RECRUIT_TYPES.map((type) => {
    const capacity = recruitCapacity(state, cityId);
    const rawMax = fpDiv(capacity, COST_POP_PER_SOLDIER[type]);
    const maxSoldiers = (Math.floor(rawMax / RECRUIT_STEP) * RECRUIT_STEP) as Fp;
    const amounts: RecruitOption['amounts'] = [];
    for (let amount = RECRUIT_MIN; amount <= maxSoldiers; amount = (amount + RECRUIT_STEP) as Fp) {
      amounts.push({
        soldiers: amount,
        check: checkRecruit(state, HUMAN_ID, cityId, type, amount),
      });
    }
    return { type, amounts };
  });
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
 * Создаёт локальный матч из JSON карты. bots — игроки под мозгом бота: по умолчанию все, кроме
 * человека; с человеком — режим наблюдения (запись матча ботов).
 * @returns движок или список ошибок карты
 */
export function createLocalEngine(
  mapJson: unknown,
  seed: number,
  players: number,
  bots: readonly number[] = Array.from({ length: players }, (_, i) => i).filter(
    (i) => i !== HUMAN_ID,
  ),
  fog = false,
): LocalEngine | { readonly errors: readonly string[] } {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) return { errors: loaded.errors };
  const setup = Array.from({ length: players }, (_, i) => ({ name: `P${i}` }));
  const state = createMatch(loaded.map, setup, seed, { fog });
  let pending: Command[] = [];
  let selected: number | null = null;
  let observerId: number | null = null;
  let pendingEvents: MatchState['events'] = [];
  const advance = (): void => {
    const viewContext = createPlayerViewContext(state);
    step(state, [
      ...pending.map((cmd) => ({ playerId: HUMAN_ID, cmd })),
      ...commanderCommands(state, bots, viewContext),
      ...botCommands(state, bots, viewContext),
    ]);
    pending = [];
    pendingEvents = [...pendingEvents, ...state.events];
  };
  const snapshot = (): ViewPayload => {
    const rejected: { command: string; reason: RejectReason }[] = [];
    for (const e of pendingEvents) {
      if (e.t === 'commandRejected' && e.playerId === HUMAN_ID && !e.auto) {
        rejected.push({ command: e.command, reason: e.reason as RejectReason });
      }
    }
    const events = pendingEvents;
    pendingEvents = [];
    return {
      t: 'view',
      seq: 0,
      view: playerView(state, observerId ?? HUMAN_ID),
      selection: selected === null ? null : selectionOf(state, selected),
      rejected,
      events,
    };
  };
  return {
    state,
    queue(cmd) {
      pending.push(cmd);
    },
    setFog(on) {
      state.fog = on;
    },
    setObserver(playerId) {
      observerId = playerId;
    },
    select(hex) {
      selected = hex;
    },
    advance,
    tick() {
      // Ручные команды игрока и решения commander (армии с auto всех игроков) — в один тик; sim
      // применяет ручные первыми, и устаревшее решение commander для взятой армии отклоняется.
      advance();
      return snapshot();
    },
    snapshot,
  };
}
