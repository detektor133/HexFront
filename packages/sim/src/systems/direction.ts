// Поддержка направлений (07-controls.md, «Меню страны»): раз в секунду армия направления на игрока
// держит фронт на всех кусках границы с ним и его союзниками, включая появившиеся позже, и ни на
// какой другой; кончившийся удар ИИ повторяет по новой обстановке, выбывший игрок снимает
// направление; ничья земля занимается отрядами.
import { commandAssaults } from './assault.ts';
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

// Фронт направления — не «едущая» линия, а сама граница с блоком цели: любая смена владельца гекса
// пересчитывает его целиком и точно. Лишних граней, которые потом надо было бы исправлять, нет.
function syncFronts(state: MatchState): void {
  state.plans.forEach((plan, i) => {
    if (plan.kind !== 'front' || plan.derived === undefined) return;
    if (plan.rev === state.supplyRevision) return;
    const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
    if (owner === undefined) return;
    const edges = borderPieces(state, owner, plan.derived).flat();
    const same = edges.length === plan.edges.length && edges.every((e, k) => e === plan.edges[k]);
    state.plans[i] = {
      ...plan,
      edges: edges.length === 0 || same ? plan.edges : edges,
      rev: state.supplyRevision,
    };
  });
}

/** Обновляет фронты (каждый тик), удары и занятие направлений (раз в секунду). */
export function maintainDirections(state: MatchState): void {
  syncFronts(state);
  commandAssaults(state);
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
    // Фронта нет (его сняли руками) — ставим по границе с блоком цели.
    if (state.plans.some((p) => p.armyId === army.id && p.kind === 'front')) continue;
    const edges = borderPieces(state, army.owner, dir.target).flat();
    if (edges.length > 0) placeFront(state, army.id, edges, dir.target);
  }
}
