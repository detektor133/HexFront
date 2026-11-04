// Поддержка направлений (07-controls.md, «Меню страны»): раз в секунду армии, которым игрок заказал
// «держать границу», получают фронт на все куски границы с целью, включая появившиеся позже и
// отрезанные, а направление на выбывшего игрока снимается.
import { TICKS_PER_S } from '../balance.ts';
import { borderPieces, releaseDirection } from '../commands/launch.ts';
import { executePlanCommand } from '../commands/plan.ts';
import { frontLinePath } from '../state/front-follow.ts';
import type { MatchState } from '../state/types.ts';

/** Обновляет фронты направлений; раз в секунду. */
export function maintainDirections(state: MatchState): void {
  if (state.tick % TICKS_PER_S !== 0) return;
  for (const army of [...state.armies]) {
    const dir = army.dir;
    if (!dir) continue;
    if (dir.target >= 0 && state.players[dir.target]?.status !== 'alive') {
      releaseDirection(state, army);
      continue;
    }
    const index = state.plans.findIndex((p) => p.armyId === army.id);
    const plan = state.plans[index];
    // Наступление на игрока кончилось — армия остаётся на новой границе и держит её.
    if (dir.mode === 'attack' && dir.target >= 0 && plan?.kind === 'front') {
      if (!plan.offensive && !plan.startWanted) army.dir = { target: dir.target, mode: 'hold' };
    }
    if (army.dir?.mode !== 'hold') continue;
    const edges = borderPieces(state, army.owner, dir.target).flat();
    if (edges.length === 0) continue;
    if (plan?.kind !== 'front') {
      executePlanCommand(state, army.owner, { t: 'assignFront', armyId: army.id, edges });
      continue;
    }
    // Фронт сам едет за границей; дополняем лишь когда на границе с целью появился кусок, которого
    // в плане нет (полной перестановки отрядов не будет — места сохраняются).
    const planned = new Set(plan.edges);
    if (edges.every((e) => planned.has(e))) continue;
    const path = frontLinePath(state, army.owner, edges);
    if (path) state.plans[index] = { ...plan, edges: path };
  }
}
