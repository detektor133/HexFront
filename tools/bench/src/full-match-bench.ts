// Раздельный бенчмарк полного локального матча.
// Запуск: pnpm --filter @hexfront/bench full-match [--players=30,100] [--minutes=N]
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { buildViewDelta, canBuildViewDelta } from '../../../apps/client/src/local/view-delta.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  encodeDelta,
  encodeSnapshot,
  type DeltaMessage,
  type SnapshotMessage,
} from '../../../packages/protocol/src/index.ts';
import { BOT_THINK_TICKS, COMMANDER_TICKS } from '../../../packages/sim/src/balance.ts';
import {
  botCommands,
  commanderCommands,
  createMatch,
  createPlayerViewContext,
  loadMap,
  playerView,
  step,
  type PlayerView,
} from '../../../packages/sim/src/index.ts';

const DEFAULT_PLAYERS: readonly number[] = [30, 100];
const DEFAULT_MINUTES = 25;
const TICKS_PER_MINUTE = 600;
const SEED = 43;
const SAMPLE_INTERVAL_TICKS = 50;
const TARGETS_MS = new Map<number, number>([
  [30, 15],
  [100, 40],
]);

export interface TimingSummary {
  readonly meanMs: number;
  readonly p95Ms: number;
}

export interface MinuteReport {
  readonly minute: number;
  readonly step: TimingSummary;
  readonly commander: TimingSummary;
  readonly economy: TimingSummary;
  readonly snapshot: TimingSummary;
  readonly playerView: TimingSummary;
  readonly delta: TimingSummary;
  readonly serialization: TimingSummary;
  readonly commanderMsPerBotTurn: number;
  readonly economyMsPerBotTurn: number;
  readonly snapshotBytes: number;
}

export interface MatchReport {
  readonly players: number;
  readonly bots: number;
  readonly ticks: number;
  readonly seed: number;
  readonly targetMeanMs: number;
  readonly minutes: readonly MinuteReport[];
  readonly total: MinuteReport;
  readonly budgetExceeded: boolean;
}

interface Options {
  readonly players: readonly number[];
  readonly minutes: number;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarize(values: readonly number[]): TimingSummary {
  if (values.length === 0) return { meanMs: 0, p95Ms: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    meanMs: rounded(meanMs),
    p95Ms: rounded(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
  };
}

export function millisecondsPerBotTurn(totalMs: number, botTurns: number): number {
  return botTurns === 0 ? 0 : rounded(totalMs / botTurns);
}

export function estimateSnapshotBytes(view: PlayerView): number {
  const arrays = [
    view.hexes.owner,
    view.hexes.pop,
    view.hexes.improvement,
    view.hexes.building,
    view.hexes.road,
    view.hexes.link,
    view.hexes.growth,
    view.hexes.visible,
  ].reduce((total, values) => total + values.length * 4, 0);
  return arrays + view.units.length * 180 + view.plans.length * 100 + 512;
}

export function parseOptions(arguments_: readonly string[]): Options {
  const playersValue = arguments_.find((argument) => argument.startsWith('--players='))?.slice(10);
  const players =
    playersValue === undefined || playersValue.length === 0
      ? DEFAULT_PLAYERS
      : playersValue.split(',').map((item) => Number(item));
  if (players.some((item) => !Number.isInteger(item) || !TARGETS_MS.has(item))) {
    throw new Error('--players должен содержать только 30 и 100');
  }
  const minutesValue = arguments_.find((argument) => argument.startsWith('--minutes='))?.slice(10);
  const minutes = minutesValue === undefined ? DEFAULT_MINUTES : Number(minutesValue);
  if (!Number.isInteger(minutes) || minutes < 1)
    throw new Error('--minutes должен быть положительным целым');
  return { players, minutes };
}

type Timings = Record<
  'step' | 'commander' | 'economy' | 'snapshot' | 'playerView' | 'delta' | 'serialization',
  number[]
>;

interface BotTurnCounts {
  commander: number;
  economy: number;
}

function emptyTimings(): Timings {
  return {
    step: [],
    commander: [],
    economy: [],
    snapshot: [],
    playerView: [],
    delta: [],
    serialization: [],
  };
}

function emptyBotTurnCounts(): BotTurnCounts {
  return { commander: 0, economy: 0 };
}

function toMinuteReport(
  minute: number,
  timings: Timings,
  botTurns: BotTurnCounts,
  snapshotBytes: number,
): MinuteReport {
  return {
    minute,
    step: summarize(timings.step),
    commander: summarize(timings.commander),
    economy: summarize(timings.economy),
    snapshot: summarize(timings.snapshot),
    playerView: summarize(timings.playerView),
    delta: summarize(timings.delta),
    serialization: summarize(timings.serialization),
    commanderMsPerBotTurn: millisecondsPerBotTurn(
      timings.commander.reduce((sum, value) => sum + value, 0),
      botTurns.commander,
    ),
    economyMsPerBotTurn: millisecondsPerBotTurn(
      timings.economy.reduce((sum, value) => sum + value, 0),
      botTurns.economy,
    ),
    snapshotBytes,
  };
}

function countScheduledBotTurns(
  state: { readonly players: readonly { readonly id: number; readonly status: string }[] },
  bots: readonly number[],
  period: number,
  tick: number,
): number {
  return state.players.filter(
    (player) =>
      player.status === 'alive' && bots.includes(player.id) && player.id % period === tick % period,
  ).length;
}

function runScenario(players: number, minutes: number): MatchReport {
  const loaded = loadMap(generateMap(SEED, { players }));
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const bots = Array.from({ length: players }, (_, id) => id);
  const state = createMatch(
    loaded.map,
    bots.map((id) => ({ name: `P${id}` })),
    SEED,
    { fog: false },
  );
  const minuteReports: MinuteReport[] = [];
  const all = emptyTimings();
  let currentMinute = emptyTimings();
  const allBotTurns = emptyBotTurnCounts();
  let currentBotTurns = emptyBotTurnCounts();
  let previousView: PlayerView | null = null;
  let snapshotBytes = 0;
  const ticks = minutes * TICKS_PER_MINUTE;

  for (let tick = 0; tick < ticks; tick += 1) {
    const timings = emptyTimings();
    const botTurns = {
      commander: countScheduledBotTurns(state, bots, COMMANDER_TICKS, state.tick),
      economy: countScheduledBotTurns(state, bots, BOT_THINK_TICKS, state.tick),
    };
    const context = createPlayerViewContext(state);
    const commanderStart = performance.now();
    const commander = commanderCommands(state, bots, context);
    timings.commander.push(performance.now() - commanderStart);
    const economyStart = performance.now();
    const economy = botCommands(state, bots, context);
    timings.economy.push(performance.now() - economyStart);
    const allCommands = [...commander, ...economy];
    const stepStart = performance.now();
    step(state, allCommands);
    timings.step.push(performance.now() - stepStart);

    const viewStart = performance.now();
    const view = playerView(state, 0);
    timings.playerView.push(performance.now() - viewStart);
    const deltaStart = performance.now();
    const delta: DeltaMessage | null =
      previousView !== null && canBuildViewDelta(previousView, view)
        ? buildViewDelta(previousView, view, state.events)
        : null;
    timings.delta.push(performance.now() - deltaStart);
    previousView = view;
    if (tick % SAMPLE_INTERVAL_TICKS === 0) {
      const serializationStart = performance.now();
      const snapshot: SnapshotMessage = { t: 'snapshot', tick: view.tick, view };
      const snapshotText = encodeSnapshot(snapshot);
      const payloadText = delta === null ? snapshotText : encodeDelta(delta);
      timings.serialization.push(performance.now() - serializationStart);
      snapshotBytes = new TextEncoder().encode(payloadText).byteLength;
    } else {
      snapshotBytes = estimateSnapshotBytes(view);
    }
    timings.snapshot.push(
      (timings.playerView[0] ?? 0) + (timings.delta[0] ?? 0) + (timings.serialization[0] ?? 0),
    );

    for (const key of Object.keys(all) as (keyof Timings)[]) all[key].push(...timings[key]);
    allBotTurns.commander += botTurns.commander;
    allBotTurns.economy += botTurns.economy;
    for (const key of Object.keys(currentMinute) as (keyof Timings)[])
      currentMinute[key].push(...timings[key]);
    currentBotTurns.commander += botTurns.commander;
    currentBotTurns.economy += botTurns.economy;
    if ((tick + 1) % TICKS_PER_MINUTE === 0) {
      const minute = (tick + 1) / TICKS_PER_MINUTE;
      minuteReports.push(toMinuteReport(minute, currentMinute, currentBotTurns, snapshotBytes));
      currentMinute = emptyTimings();
      currentBotTurns = emptyBotTurnCounts();
      process.stderr.write(`players=${players} minute=${minute}/${minutes}\n`);
    }
  }
  const total = toMinuteReport(minutes, all, allBotTurns, snapshotBytes);
  const targetMeanMs = TARGETS_MS.get(players) ?? 0;
  const fullTickMean =
    total.step.meanMs + total.commander.meanMs + total.economy.meanMs + total.snapshot.meanMs;
  return {
    players,
    bots: bots.length,
    ticks,
    seed: SEED,
    targetMeanMs,
    minutes: minuteReports,
    total,
    budgetExceeded: fullTickMean > targetMeanMs,
  };
}

export function run(arguments_: readonly string[] = process.argv.slice(2)): readonly MatchReport[] {
  const options = parseOptions(arguments_);
  const reports = options.players.map((players) => runScenario(players, options.minutes));
  const resultDirectory = new URL('../results/', import.meta.url);
  mkdirSync(resultDirectory, { recursive: true });
  writeFileSync(
    new URL(`full-match-${Date.now()}.json`, resultDirectory),
    JSON.stringify({ node: process.version, map: 'gen', scenarios: reports }, null, 2),
  );
  return reports;
}

if (process.argv[1]?.endsWith('full-match-bench.ts')) {
  console.log(JSON.stringify({ node: process.version, map: 'gen', scenarios: run() }, null, 2));
}
