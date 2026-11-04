// Поддержка направлений (07-controls.md, «Меню страны»): раз в секунду армия направления на игрока
// держит фронт на всех кусках границы с ним, включая появившиеся позже; кончившийся удар
// продолжается до клика, выбывший игрок снимает направление; ничья земля занимается отрядами.
import { expandNeutral } from './expand.ts';
import { TICKS_PER_S } from '../balance.ts';
import { borderPieces, continueStrike, releaseDirection } from '../commands/launch.ts';
import { executePlanCommand } from '../commands/plan.ts';
import { frontLinePath } from '../state/front-follow.ts';
import type { MatchState } from '../state/types.ts';

/** Обновляет фронты, удары и занятие направлений; раз в секунду. */
export function maintainDirections(state: MatchState): void {
  if (state.tick % TICKS_PER_S !== 0) return;
  for (const army of [...state.armies]) {
    const dir = army.dir;
    if (!dir) continue;
    if (dir.target < 0) {
      if (dir.mode === 'attack') expandNeutral(state, army);
      continue;
    }
    if (state.players[dir.target]?.status !== 'alive') {
      releaseDirection(state, army);
      continue;
    }
    const first = state.plans.find((p) => p.armyId === army.id);
    // Наступление кончилось — продолжаем до клика или переходим в «держать».
    if (
      dir.mode === 'attack' &&
      first?.kind === 'front' &&
      !first.offensive &&
      !first.startWanted
    ) {
      continueStrike(state, army);
    }
    const edges = borderPieces(state, army.owner, dir.target).flat();
    if (edges.length === 0) continue;
    const index = state.plans.findIndex((p) => p.armyId === army.id);
    const plan = state.plans[index];
    if (plan?.kind !== 'front') {
      executePlanCommand(state, army.owner, { t: 'assignFront', armyId: army.id, edges });
      continue;
    }
    // Фронт сам едет за границей; дополняем, когда на границе с целью появился кусок, которого в
    // плане нет. Наступление и места отрядов при этом сохраняются.
    const planned = new Set(plan.edges);
    if (edges.every((e) => planned.has(e))) continue;
    const path = frontLinePath(state, army.owner, edges);
    if (path) state.plans[index] = { ...plan, edges: path };
  }
}
