// Бенч конвейера матча по форматам игры: серверная комната и одиночная игра на клиенте.
//
// Запуск (из корня репозитория):
//   node --expose-gc --experimental-strip-types tools/bench/src/net-bench.ts [опции]
// Опции:
//   --map=gen|europe|small   карта (gen — генерируемая 30 игроков, как «быстрый матч»); по умолчанию gen
//   --level=easy|medium|hard уровень ботов; по умолчанию medium
//   --humans=N               людей в комнате сервера (виды, дельты, JSON на каждого); по умолчанию 30
//   --minutes=M              длина матча в минутах игры (ускоренно, без реального времени); по умолчанию 6
//   --solo                   одиночная игра на реальном движке клиента (один человек, как в воркере)
// Печатает по минуте матча: мс на тик по стадиям, байты дельты, память (после GC), отряды.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

import { createLocalEngine } from '../../../apps/client/src/local/engine.ts';
import { ConfirmedViewDeltaStream } from '../../../apps/client/src/local/view-delta.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  buildViewDelta,
  canBuildViewDelta,
  encodeDelta,
  paceView,
  slowLayerReuse,
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
  type BotLevel,
  type MatchState,
  type PlayerView,
} from '../../../packages/sim/src/index.ts';
import { allUnits } from '../../../packages/sim/src/state/unit-index.ts';

const SEED = 43;
const TICKS_PER_MINUTE = 600;
/** Сжимаем каждого шестого игрока: deflate на всех искажал бы замер времени стадий. */
const DEFLATE_EVERY = 6;

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const MAP = option('map', 'gen');
const LEVEL = option('level', 'medium') as BotLevel;
const HUMANS = Number(option('humans', '30'));
const MINUTES = Number(option('minutes', '6'));
const SOLO = process.argv.includes('--solo');

/** Карта формата: JSON готовой карты или сгенерированная; игроков в матче всегда 30 (как в меню). */
function mapJson(): unknown {
  if (MAP === 'gen') return generateMap(SEED, { players: 30 });
  const file = new URL(`../../../packages/mapgen/maps/${MAP}.json`, import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

interface Window {
  stages: Record<string, number>;
  bytes: number;
  deflated: number;
  messages: number;
}

const empty = (): Window => ({ stages: {}, bytes: 0, deflated: 0, messages: 0 });
const add = (window: Window, stage: string, since: number): number => {
  const now = performance.now();
  window.stages[stage] = (window.stages[stage] ?? 0) + (now - since);
  return now;
};

/** Куча и RSS в МБ; куча — после принудительной сборки мусора, если доступна. */
function memory(): string {
  (globalThis as { gc?: () => void }).gc?.();
  const usage = process.memoryUsage();
  const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);
  return `куча ${mb(usage.heapUsed)} МБ, rss ${mb(usage.rss)} МБ`;
}

function report(minute: number, window: Window, state: MatchState, hexes: number): void {
  const per = (value: number): number => value / TICKS_PER_MINUTE;
  const parts = Object.entries(window.stages).map(([name, ms]) => `${name} ${per(ms).toFixed(1)}`);
  const total = Object.values(window.stages).reduce((sum, ms) => sum + per(ms), 0);
  const bytes = Math.round(window.bytes / Math.max(1, window.messages));
  const deflated = Math.round(window.deflated / Math.max(1, window.messages));
  const alive = state.players.filter((p) => p.status === 'alive').length;
  console.log(
    `мин ${String(minute).padStart(2)}: ${parts.join(' ')} = ${total.toFixed(1)} мс/тик | ` +
      `дельта ${bytes} Б (deflate ${deflated}, ${((deflated * 10) / 1024).toFixed(1)} КБ/с) | ` +
      `${memory()} | живых ${alive}, отрядов ${allUnits(state).length}, гексов ${hexes}` +
      (state.winner >= 0 ? `, ПОБЕДИТЕЛЬ ${state.winner}` : ''),
  );
}

/** Комната сервера: боты, step, виды и дельты для `HUMANS` людей. */
function runRoom(): void {
  const loaded = loadMap(mapJson());
  if ('errors' in loaded) throw new Error(loaded.errors.join('\n'));
  const players = loaded.map.spawns.length;
  const ids = Array.from({ length: players }, (_, id) => id);
  const levels = ids.map(() => LEVEL);
  const state = createMatch(
    loaded.map,
    ids.map((id) => ({ name: `P${id}` })),
    SEED,
    { fog: true },
  );
  const humans = Math.min(HUMANS, players);
  const confirmed: (PlayerView | null)[] = Array(humans).fill(null);
  const syncedAt: number[] = Array(humans).fill(0);
  let window = empty();
  for (let tick = 0; tick < MINUTES * TICKS_PER_MINUTE; tick += 1) {
    let at = performance.now();
    const context = createBotTickContext(state);
    const commands = [
      ...commanderCommands(state, ids, levels, context),
      ...botCommands(state, ids, levels, context),
    ];
    at = add(window, 'боты', at);
    step(state, commands);
    at = add(window, 'step', at);
    const viewContext = createPlayerViewContext(state);
    const syncs = Array.from(
      { length: humans },
      (_, id) => state.tick - (syncedAt[id] as number) >= SLOW_PERIOD_TICKS,
    );
    const views = Array.from({ length: humans }, (_, id) =>
      playerView(
        state,
        id,
        viewContext,
        slowLayerReuse(confirmed[id] ?? null, syncs[id] as boolean),
      ),
    );
    at = add(window, 'виды', at);
    for (let id = 0; id < humans; id += 1) {
      const view = views[id] as PlayerView;
      const base = confirmed[id] ?? null;
      if (base === null || !canBuildViewDelta(base, view)) {
        confirmed[id] = view;
        continue;
      }
      const sync = syncs[id] as boolean;
      if (sync) syncedAt[id] = view.tick;
      const sent = paceView(base, view, sync);
      const message = buildViewDelta(base, sent, state.events);
      at = add(window, 'дельты', at);
      const text = encodeDelta(message);
      at = add(window, 'json', at);
      window.bytes += text.length;
      window.messages += 1;
      if (id % DEFLATE_EVERY === 0) window.deflated += deflateRawSync(text).length * DEFLATE_EVERY;
      confirmed[id] = sent;
    }
    if ((tick + 1) % TICKS_PER_MINUTE === 0) {
      report((tick + 1) / TICKS_PER_MINUTE, window, state, state.hexes.owner.length);
      window = empty();
    }
  }
}

/** Одиночная игра: тот же движок и поток дельт, что в воркере клиента (один человек, 29 ботов). */
function runSolo(): void {
  const json = mapJson();
  const loaded = loadMap(json);
  if ('errors' in loaded) throw new Error(loaded.errors.join('\n'));
  const made = createLocalEngine(
    json,
    SEED,
    loaded.map.spawns.length,
    undefined,
    true,
    '',
    true,
    false,
    LEVEL,
  );
  if ('errors' in made) throw new Error(made.errors.join('\n'));
  const stream = new ConfirmedViewDeltaStream();
  let window = empty();
  for (let tick = 0; tick < MINUTES * TICKS_PER_MINUTE; tick += 1) {
    let at = performance.now();
    made.advance();
    at = add(window, 'боты+step', at);
    const payload = made.snapshot();
    at = add(window, 'вид', at);
    const transport = stream.next(payload.view, payload.events);
    if (transport?.kind === 'delta') {
      at = add(window, 'дельта', at);
      const text = encodeDelta(transport.delta);
      add(window, 'json', at);
      window.bytes += text.length;
      window.messages += 1;
      window.deflated += deflateRawSync(text).length;
    }
    stream.acknowledge();
    if ((tick + 1) % TICKS_PER_MINUTE === 0) {
      report((tick + 1) / TICKS_PER_MINUTE, window, made.state, made.state.hexes.owner.length);
      window = empty();
    }
  }
}

console.log(
  `формат: ${SOLO ? 'одиночная игра' : `комната сервера, людей ${HUMANS}`}, карта ${MAP}, боты ${LEVEL}, ${MINUTES} мин`,
);
if (SOLO) runSolo();
else runRoom();
