// Детерминированный сценарий «война двух игроков 5 минут» для golden-реплея этапа 03.
// Решения — только по состоянию матча: набор пехоты в столице, затем наступление на столицу врага.
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

function capitalHex(state: MatchState, playerId: number): number | undefined {
  const id = state.players[playerId]?.capitalCityId;
  return state.cities.find((c) => c.id === id && c.owner === playerId)?.hex;
}

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

// Свободные отряды идут на столицу врага; путь, упёршийся во врага, становится атакой.
function offensive(state: MatchState, playerId: number, enemyId: number): Command | null {
  const target = capitalHex(state, enemyId);
  if (target === undefined) return null;
  const ready = state.units.filter(
    (u) => u.owner === playerId && (u.order === 'idle' || u.order === 'expand'),
  );
  return ready.length > 0 ? { t: 'move', unitIds: ready.map((u) => u.id), to: target } : null;
}

/** Команды обоих игроков на этот тик (пусто между моментами решений). */
export function warCommands(state: MatchState): PlayerCommand[] {
  if (state.tick % DECIDE_EVERY !== 0) return [];
  const out: PlayerCommand[] = [];
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const enemy = p.id === 0 ? 1 : 0;
    const recruit = recruitCommand(state, p.id);
    if (recruit) out.push({ playerId: p.id, cmd: recruit });
    if (state.tick < ATTACK_FROM) continue;
    // Отряды по одному: общий путь стопки упирается в лимит 3 отряда на гекс.
    const move = offensive(state, p.id, enemy);
    if (move && move.t === 'move') {
      for (const id of move.unitIds) {
        out.push({ playerId: p.id, cmd: { t: 'move', unitIds: [id], to: move.to } });
      }
    }
  }
  return out;
}
