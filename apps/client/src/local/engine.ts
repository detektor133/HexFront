// Движок локального режима: матч sim, очередь команд игрока, снимок каждый тик.
// Живёт в Web Worker (sim-worker.ts); отдельно — чтобы тестироваться без браузера.
import type { SnapshotMessage } from '@hexfront/protocol';
import {
  previewPath,
  buildMask,
  supplyLevels,
  type BotLevel,
  type BuildMaskKind,
  type PathPreview,
  FP,
  hexPopCap,
  botCommands,
  botName,
  commanderCommands,
  createMatch,
  createBotTickContext,
  loadMap,
  playerView,
  selectionFor,
  step,
  type Command,
  type MatchState,
  type RejectReason,
} from '@hexfront/sim';

import type { MapMaskMode, ViewPayload } from './messages.ts';
import { createDirector, directorCommands } from './tutorial-director.ts';

/**
 * В локальном режиме игрок-человек — всегда id 0; армиями с auto у всех командует commander,
 * экономикой ботов — мозг бота (09-bots.md).
 */
export const HUMAN_ID = 0;

/** В уроке люди на землях игрока растут быстрее: город можно основать за минуты, а не за полчаса. */
const TUTORIAL_GROWTH_TICKS = 1200;

function boostPeople(state: MatchState): void {
  const owner = state.hexes.owner;
  for (let h = 0; h < owner.length; h += 1) {
    if (owner[h] !== HUMAN_ID) continue;
    const cap = hexPopCap(state, h);
    const pop = state.hexes.pop[h] ?? 0;
    if (cap > 0 && pop < cap)
      state.hexes.pop[h] = Math.min(cap, pop + Math.ceil(cap / TUTORIAL_GROWTH_TICKS));
  }
}

export interface LocalEngine {
  readonly state: MatchState;
  queue(cmd: Command): void;
  /** Шаг матча-урока: по нему режиссёр управляет соперником. */
  setTutorialStage(stage: string): void;
  setFog(on: boolean): void;
  setObserver(playerId: number | null): void;
  /** Путь и время для выбранных отрядов игрока; состояние не меняется. */
  previewPath(unitIds: readonly number[], to: number, via: readonly number[]): PathPreview | null;
  setView(playerId: number | null, fog: boolean): void;
  /** Маска режима карты: снабжение или «где можно строить»; состояние не меняется. */
  mapMask(mode: MapMaskMode): Uint8Array;
  select(hex: number | null): void;
  /** Один тик симуляции; возвращает снимок для страницы. */
  tick(): ViewPayload;
  /** Возвращает накопленный снимок без продвижения симуляции. */
  snapshot(): ViewPayload;
  /** Продвигает один тик без построения снимка. */
  advance(): void;
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
  playerName = '',
  diplomacy = false,
  tutorial = false,
  botLevel: BotLevel = 'medium',
  spawn?: number,
  freeStarts = false,
  cityNames: readonly string[] = [],
): LocalEngine | { readonly errors: readonly string[] } {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) return { errors: loaded.errors };
  const names: string[] = [];
  const setup = Array.from({ length: players }, (_, i) => ({
    name: ((): string => {
      const name = i === HUMAN_ID ? playerName || 'Игрок 1' : botName(seed, i, names);
      names.push(name);
      return name;
    })(),
    ...(i === HUMAN_ID && cityNames.length > 0 ? { cityNames } : {}),
    ...(i === HUMAN_ID && spawn !== undefined ? (freeStarts ? { start: spawn } : { spawn }) : {}),
  }));
  const state = createMatch(loaded.map, setup, seed, {
    fog,
    diplomacy,
    ...(freeStarts ? { freeStarts: true } : {}),
    ...(tutorial ? { noVictory: true } : {}),
  });
  // Человек сам ведёт войска (меню направлений): автокомандование стартовой армии выключено, иначе
  // commander двигал бы отряды и сбрасывал планы. У ботов оно остаётся — это их мозг.
  if (!bots.includes(HUMAN_ID)) {
    const me = state.players[HUMAN_ID];
    if (me) me.autoCommand = false;
    for (const army of state.armies) if (army.owner === HUMAN_ID) army.auto = false;
  }
  // Матч-урок: соперником управляет только режиссёр урока, его командир отключён.
  if (tutorial) {
    for (const p of state.players) if (p.id !== HUMAN_ID) p.autoCommand = false;
    for (const army of state.armies) if (army.owner !== HUMAN_ID) army.auto = false;
  }
  let pending: Command[] = [];
  // Стартовые отряды человека сразу в армии с приказом занимать ничью землю (ИИ раскидывает их роем),
  // а не стоят без дела, пока игрок не откроет меню.
  // В уроке игрок сам учится занимать землю: автоприказ не отдаётся.
  if (!bots.includes(HUMAN_ID) && !tutorial) {
    const soldiers = state.units
      .filter((u) => u.owner === HUMAN_ID)
      .reduce((sum, u) => sum + u.soldiers, 0);
    if (soldiers > 0) {
      pending.push({ t: 'launchOffensive', target: -1, soldiers: Math.ceil(soldiers / FP) });
    }
  }
  const levels = Array.from({ length: players }, () => botLevel);
  const director = createDirector();
  let selected: number | null = null;
  let observerId: number | null = null;
  let pendingEvents: MatchState['events'] = [];
  const advance = (): void => {
    const botContext = createBotTickContext(state);
    step(state, [
      ...pending.map((cmd) => ({ playerId: HUMAN_ID, cmd })),
      ...(tutorial ? directorCommands(state, director) : []),
      ...commanderCommands(state, bots, levels, botContext),
      ...botCommands(state, bots, levels, botContext),
    ]);
    pending = [];
    if (tutorial) boostPeople(state);
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
    const view = playerView(state, observerId ?? HUMAN_ID);
    const snapshot: SnapshotMessage = { t: 'snapshot', tick: view.tick, view };
    return {
      t: 'view',
      seq: 0,
      view,
      kind: 'snapshot',
      snapshot,
      selection: selected === null ? null : selectionFor(state, HUMAN_ID, selected),
      rejected,
      events,
    };
  };
  return {
    state,
    queue(cmd) {
      pending.push(cmd);
    },
    setTutorialStage(stage) {
      director.stage = stage;
    },
    setFog(on) {
      state.fog = on;
    },
    setObserver(playerId) {
      observerId = playerId;
    },
    setView(playerId, fog) {
      observerId = playerId;
      state.fog = fog;
    },
    select(hex) {
      selected = hex;
    },
    mapMask(mode) {
      const me = observerId ?? HUMAN_ID;
      if (mode === 'supply') return supplyLevels(state, me);
      const kind = mode.slice('build:'.length) as BuildMaskKind;
      return buildMask(state, me, kind);
    },
    previewPath(unitIds, to, via) {
      return previewPath(state, observerId ?? 0, unitIds, to, via);
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
