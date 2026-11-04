// Поддержка направлений (07-controls.md, «Меню страны»): раз в секунду армия направления на игрока
// держит фронт на всех кусках границы с ним и его союзниками, включая появившиеся позже, и ни на
// какой другой; кончившийся удар ИИ повторяет по новой обстановке, выбывший игрок снимает
// направление; ничья земля занимается отрядами.
import { expandNeutral } from './expand.ts';
import { AXIS_REFRESH_S, TICKS_PER_S } from '../balance.ts';
import {
  borderPieces,
  continueStrike,
  refreshStrike,
  releaseDirection,
} from '../commands/launch.ts';
import { placeFront } from '../commands/plan.ts';
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
    // Идущее наступление ИИ обновляет: выполненные линии снимает, вместо них строит новые оси.
    if (dir.mode === 'attack' && state.tick % (AXIS_REFRESH_S * TICKS_PER_S) === 0) {
      refreshStrike(state, army);
    }
    const edges = borderPieces(state, army.owner, dir.target).flat();
    if (edges.length === 0) continue;
    const index = state.plans.findIndex((p) => p.armyId === army.id);
    const plan = state.plans[index];
    if (plan?.kind !== 'front') {
      placeFront(state, army.id, edges);
      continue;
    }
    // Фронт лежит ровно на границе с блоком цели: лишние грани (чужая граница) убираются, новые
    // куски добавляются. Наступление и места отрядов при этом сохраняются.
    const wanted = new Set(edges);
    const planned = new Set(plan.edges);
    if (edges.every((e) => planned.has(e)) && plan.edges.every((e) => wanted.has(e))) continue;
    state.plans[index] = { ...plan, edges };
  }
}
