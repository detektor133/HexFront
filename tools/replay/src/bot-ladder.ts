// Лестница сложности ботов: матчи, где за одним столом сидят боты всех трёх уровней (места по кругу
// между уровнями, чтобы убрать влияние старта), и сводка по уровню: доля очков, выживание, победы,
// войны, договоры. Сложный должен набирать больше среднего, а средний — больше лёгкого.
// Запуск: pnpm --filter @hexfront/replay ladder [сидов] [минут] [игроков]
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import { BOT_PROFILES } from '../../../packages/sim/src/balance.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
  TICKS_PER_S,
  type BotLevel,
} from '../../../packages/sim/src/index.ts';
import { playerScores } from '../../../packages/sim/src/queries/score.ts';

// Подбор профилей: LADDER_PROFILE='{"medium":{"maxWars":2}}' переопределяет поля профиля на время запуска.
const override = process.env.LADDER_PROFILE;
if (override) {
  for (const [level, patch] of Object.entries(JSON.parse(override) as Record<string, object>)) {
    Object.assign(BOT_PROFILES[level as BotLevel], patch);
  }
}

const SEEDS = Number(process.argv[2] ?? 4);
const MINUTES = Number(process.argv[3] ?? 20);
const PLAYERS = Number(process.argv[4] ?? 9);
const LEVELS: readonly BotLevel[] = ['easy', 'normal', 'medium'];

interface Tally {
  seats: number;
  share: number;
  alive: number;
  wins: number;
  wars: number;
  treaties: number;
  breaks: number;
  firstWarS: number[];
}

const tally = (): Tally => ({
  seats: 0,
  share: 0,
  alive: 0,
  wins: 0,
  wars: 0,
  treaties: 0,
  breaks: 0,
  firstWarS: [],
});
const byLevel = new Map<BotLevel, Tally>(LEVELS.map((level) => [level, tally()]));

for (let seed = 1; seed <= SEEDS; seed += 1) {
  const loaded = loadMap(generateMap(seed, { width: 80, height: 60, players: PLAYERS }));
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(
    loaded.map,
    Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i}` })),
    seed,
    { diplomacy: true },
  );
  const bots = state.players.map((p) => p.id);
  const levels: BotLevel[] = bots.map((id) => LEVELS[(id + seed) % LEVELS.length] as BotLevel);
  const firstWar = new Map<number, number>();
  const limit = MINUTES * 60 * TICKS_PER_S;
  while (state.winner < 0 && state.tick < limit) {
    const context = createBotTickContext(state);
    const commands = [
      ...commanderCommands(state, bots, levels, context),
      ...botCommands(state, bots, levels, context),
    ];
    step(state, commands);
    for (const e of state.events) {
      const who = 'playerId' in e ? e.playerId : -1;
      const row = byLevel.get(levels[who] ?? 'medium');
      if (!row || who < 0) continue;
      if (e.t === 'warDeclared') {
        row.wars += 1;
        if (!firstWar.has(who)) firstWar.set(who, state.tick);
      }
      if (e.t === 'treatyMade') row.treaties += 1;
      if (e.t === 'treatyBroken') row.breaks += 1;
    }
  }
  const scores = playerScores(state);
  const total = scores.reduce((sum, value) => sum + value, 0) || 1;
  for (const p of state.players) {
    const row = byLevel.get(levels[p.id] ?? 'medium');
    if (!row) continue;
    row.seats += 1;
    row.share += (scores[p.id] ?? 0) / total;
    if (p.status === 'alive') row.alive += 1;
    if (state.winner === p.id) row.wins += 1;
    const war = firstWar.get(p.id);
    if (war !== undefined) row.firstWarS.push(war / TICKS_PER_S);
  }
  console.log(
    `seed ${seed}: ${state.tick / TICKS_PER_S} с, победитель ${state.winner}, уровни [${levels.join(',')}]`,
  );
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
for (const level of LEVELS) {
  const row = byLevel.get(level) as Tally;
  const seats = Math.max(1, row.seats);
  const first =
    row.firstWarS.length === 0
      ? '—'
      : `${Math.round(row.firstWarS.reduce((a, b) => a + b, 0) / row.firstWarS.length)} с`;
  console.log(
    `${level.padEnd(7)} мест ${row.seats}  доля очков ${pct(row.share / seats)}  выжило ${pct(row.alive / seats)}  побед ${row.wins}  войн ${row.wars}  договоров ${row.treaties}  разрывов ${row.breaks}  первая война ${first}`,
  );
}
