// Проверка и применение команд — первый шаг тика (sim-core.md, «Порядок систем», п. 1).
import { rejected, type Command, type PlayerCommand, type Validation } from './types.ts';
import type { MatchState } from '../state/types.ts';

export type { PlayerCommand } from './types.ts';

function assertNever(x: never): never {
  throw new Error(`неизвестная команда: ${JSON.stringify(x)}`);
}

// Каждая команда получит свою проверку в этапе, где появляется её механика.
function validateCommand(cmd: Command): Validation {
  switch (cmd.t) {
    case 'setTax':
    case 'move':
    case 'attack':
    case 'setOrder':
    case 'assignFront':
    case 'arrow':
    case 'arrowStop':
    case 'split':
    case 'merge':
    case 'bombard':
    case 'recruit':
    case 'foundCity':
    case 'upgradeCity':
    case 'improve':
    case 'build':
    case 'rebuildSupply':
      return rejected('notImplemented');
    default:
      return assertNever(cmd);
  }
}

/**
 * Проверяет команду игрока, не меняя состояние.
 * @returns OK или отказ с причиной
 */
export function validate(state: MatchState, playerId: number, cmd: Command): Validation {
  const player = state.players[playerId];
  if (!player) return rejected('unknownPlayer');
  if (player.status !== 'alive') return rejected('playerEliminated');
  return validateCommand(cmd);
}

/**
 * Применяет команды по порядку: по playerId, внутри игрока — по порядку поступления.
 * Отклонённые не меняют состояние и попадают в state.events.
 */
export function applyCommands(state: MatchState, commands: readonly PlayerCommand[]): void {
  // sort стабилен (ES2019), поэтому порядок поступления внутри игрока сохраняется.
  const ordered = [...commands].sort((a, b) => a.playerId - b.playerId);
  for (const { playerId, cmd } of ordered) {
    const result = validate(state, playerId, cmd);
    if (!result.ok) {
      state.events.push({ t: 'commandRejected', playerId, command: cmd.t, reason: result.reason });
    }
  }
}
