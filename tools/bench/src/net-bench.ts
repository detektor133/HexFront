// Бенч сетевого конвейера сервера: на каждый тик матча ботов — вид, дельта и сериализация для N людей.
// Запуск: pnpm --filter @hexfront/bench net [людей=30] [тиков=3600]
// Печатает по минуте матча: мс на тик по стадиям, байты дельты на игрока (сырые и deflate), память
// (с `node --expose-gc` — после сборки мусора, иначе утечку от мусора не отличить), живых и отрядов.
import { deflateRawSync } from 'node:zlib';

import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  buildViewDelta,
  canBuildViewDelta,
  encodeDelta,
  paceView,
  SLOW_PERIOD_TICKS,
} from '../../../packages/protocol/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  createPlayerViewContext,
  loadMap,
  playerView,
  step,
  type PlayerView,
} from '../../../packages/sim/src/index.ts';
import { allUnits } from '../../../packages/sim/src/state/unit-index.ts';

const PLAYERS = 30;
const SEED = 43;
const TICKS_PER_MINUTE = 600;
/** Сжимаем каждого шестого игрока: deflate на всех искажал бы замер времени стадий. */
const DEFLATE_EVERY = 6;

interface Window {
  bots: number;
  step: number;
  view: number;
  delta: number;
  json: number;
  bytes: number;
  deflated: number;
  messages: number;
}

const empty = (): Window => ({
  bots: 0,
  step: 0,
  view: 0,
  delta: 0,
  json: 0,
  bytes: 0,
  deflated: 0,
  messages: 0,
});

/** Куча и RSS в МБ; куча — после принудительной сборки мусора, если доступна. */
function memory(): string {
  (globalThis as { gc?: () => void }).gc?.();
  const usage = process.memoryUsage();
  const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);
  return `куча ${mb(usage.heapUsed)} МБ, буферы ${mb(usage.arrayBuffers)} МБ, rss ${mb(usage.rss)} МБ`;
}

function run(humans: number, ticks: number): void {
  const loaded = loadMap(generateMap(SEED, { players: PLAYERS }));
  if ('errors' in loaded) throw new Error(loaded.errors.join('\n'));
  const bots = Array.from({ length: PLAYERS }, (_, id) => id);
  const state = createMatch(
    loaded.map,
    bots.map((id) => ({ name: `P${id}` })),
    SEED,
    { fog: true },
  );
  const confirmed: (PlayerView | null)[] = Array(humans).fill(null);
  const syncedAt: number[] = Array(humans).fill(0);
  let window = empty();

  for (let tick = 0; tick < ticks; tick += 1) {
    let started = performance.now();
    const context = createBotTickContext(state);
    const commands = [
      ...commanderCommands(state, bots, context),
      ...botCommands(state, bots, context),
    ];
    window.bots += performance.now() - started;
    started = performance.now();
    step(state, commands);
    window.step += performance.now() - started;

    started = performance.now();
    const viewContext = createPlayerViewContext(state);
    const views = Array.from({ length: humans }, (_, id) => playerView(state, id, viewContext));
    window.view += performance.now() - started;

    for (let id = 0; id < humans; id += 1) {
      const view = views[id] as PlayerView;
      const base = confirmed[id] ?? null;
      if (base === null || !canBuildViewDelta(base, view)) {
        confirmed[id] = view;
        continue;
      }
      started = performance.now();
      const sync = view.tick - (syncedAt[id] as number) >= SLOW_PERIOD_TICKS;
      if (sync) syncedAt[id] = view.tick;
      const sent = paceView(base, view, sync);
      const message = buildViewDelta(base, sent, state.events);
      window.delta += performance.now() - started;
      started = performance.now();
      const text = encodeDelta(message);
      window.json += performance.now() - started;
      window.bytes += text.length;
      window.messages += 1;
      if (id % DEFLATE_EVERY === 0) window.deflated += deflateRawSync(text).length * DEFLATE_EVERY;
      confirmed[id] = sent;
    }

    if ((tick + 1) % TICKS_PER_MINUTE === 0) {
      const minute = (tick + 1) / TICKS_PER_MINUTE;
      const per = (value: number): string => (value / TICKS_PER_MINUTE).toFixed(1);
      const bytes = Math.round(window.bytes / Math.max(1, window.messages));
      const deflated = Math.round(window.deflated / Math.max(1, window.messages));
      const total =
        (window.bots + window.step + window.view + window.delta + window.json) / TICKS_PER_MINUTE;
      console.log(
        `минута ${minute}: мс/тик боты ${per(window.bots)} step ${per(window.step)} виды ${per(window.view)} ` +
          `дельты ${per(window.delta)} json ${per(window.json)} = ${total.toFixed(1)} из 100 | ` +
          `байт/игрок/тик ${bytes}, deflate ${deflated} (${((deflated * 10) / 1024).toFixed(1)} КБ/с)`,
      );
      console.log(
        `        память: ${memory()}, живых ${state.players.filter((p) => p.status === 'alive').length}, отрядов ${allUnits(state).length}${state.winner >= 0 ? `, ПОБЕДИТЕЛЬ ${state.winner}` : ''}`,
      );
      window = empty();
    }
  }
}

run(Number(process.argv[2] ?? PLAYERS), Number(process.argv[3] ?? TICKS_PER_MINUTE * 6));
