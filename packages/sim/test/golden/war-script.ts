// Детерминированный сценарий «война двух игроков 5 минут» для golden-реплея этапа 03.
// Решения — только по состоянию матча: набор пехоты в столице; армии ведёт commander (CR-006) —
// фронт на границе с врагом, резерв в армию; с первой минуты игрок жмёт ▶ — линию строит commander.
import { commanderCommands } from '../../src/bots/run.ts';
import { checkRecruit } from '../../src/commands/recruit.ts';
import type { Command, PlayerCommand } from '../../src/commands/types.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import type { MatchState } from '../../src/state/types.ts';

/** Длина реплея: 5 минут при 10 тиках в секунду. */
export const WAR_TICKS = 3000;
/** Решения — раз в 10 с. */
const DECIDE_EVERY = 100;
/** Первая минута — экспансия и набор, дальше — наступление. */
const ATTACK_FROM = 600;
/** Наибольший набор за раз, солдат. */
const RECRUIT_MAX = 300;
const RECRUIT_STEP = 50;

// Самый крупный доступный набор пехоты в столице.
function recruitCommand(state: MatchState, playerId: number): Command | null {
  const capital = state.cities.find((c) => c.id === state.players[playerId]?.capitalCityId);
  if (!capital || capital.owner !== playerId) return null;
  for (let n = RECRUIT_MAX; n >= RECRUIT_STEP; n -= RECRUIT_STEP) {
    const soldiers = (n * FP) as Fp;
    if (checkRecruit(state, playerId, capital.id, 'infantry', soldiers).ok) {
      return { t: 'recruit', cityId: capital.id, type: 'infantry', soldiers };
    }
  }
  return null;
}

// ▶ у армий с фронтом без идущего наступления: линию по ▶ строит commander.
function startOffensives(state: MatchState, playerId: number): PlayerCommand[] {
  return state.plans
    .filter((p) => p.kind === 'front' && !p.offensive?.active && !p.startWanted)
    .filter((p) => state.armies.some((a) => a.id === p.armyId && a.owner === playerId && a.auto))
    .map((p) => ({ playerId, cmd: { t: 'startOffensive', armyId: p.armyId } }));
}

/** Команды обоих игроков на этот тик: commander каждый тик, решения сценария — раз в 10 с. */
export function warCommands(state: MatchState): PlayerCommand[] {
  const out = commanderCommands(state);
  if (state.tick % DECIDE_EVERY !== 0) return out;
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const recruit = recruitCommand(state, p.id);
    if (recruit) out.push({ playerId: p.id, cmd: recruit });
    if (state.tick >= ATTACK_FROM) out.push(...startOffensives(state, p.id));
  }
  return out;
}
