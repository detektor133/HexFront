// Один тик симуляции (100 мс). Порядок систем — контракт из docs/architecture/sim-core.md,
// меняется только через ADR.
import { applyCommands, type PlayerCommand } from './commands/apply.ts';
import type { MatchState } from './state/types.ts';
import { artillerySystem } from './systems/artillery.ts';
import { attritionSystem } from './systems/attrition.ts';
import { capitalSystem } from './systems/capital.ts';
import { combatSystem } from './systems/combat.ts';
import { constructionSystem } from './systems/construction.ts';
import { economySystem } from './systems/economy.ts';
import { frontSystem } from './systems/front.ts';
import { movementSystem } from './systems/movement.ts';
import { networkSystem } from './systems/network.ts';
import { offensiveSystem } from './systems/offensive.ts';
import { orgRegenSystem } from './systems/org-regen.ts';
import { populationSystem } from './systems/population.ts';
import { recruitSystem } from './systems/recruit.ts';
import { supplySystem } from './systems/supply.ts';
import { taxSystem } from './systems/tax.ts';
import { victorySystem } from './systems/victory.ts';
import { visionSystem } from './systems/vision.ts';

type System = (state: MatchState) => void;

/** Системы после applyCommands, в порядке sim-core.md (пункты 2–18). */
export const SYSTEMS: readonly System[] = [
  taxSystem,
  constructionSystem,
  recruitSystem,
  networkSystem,
  supplySystem,
  frontSystem,
  offensiveSystem,
  movementSystem,
  artillerySystem,
  combatSystem,
  attritionSystem,
  orgRegenSystem,
  populationSystem,
  economySystem,
  capitalSystem,
  visionSystem,
  victorySystem,
];

/**
 * Продвигает матч на один тик. Мутирует и возвращает то же состояние.
 * Отклонённые команды попадают в state.events.
 * @returns состояние после тика
 */
export function step(state: MatchState, commands: readonly PlayerCommand[]): MatchState {
  state.events = [];
  applyCommands(state, commands);
  for (const system of SYSTEMS) system(state);
  state.tick += 1;
  return state;
}
