// Поддержка направлений (07-controls.md, «Меню страны»): раз в секунду армия направления на игрока
// держит фронт на всех кусках границы с ним, включая появившиеся позже, и ни на
// какой другой; кончившийся удар ИИ повторяет по новой обстановке, выбывший игрок снимает
// направление; ничья земля занимается отрядами.
import { commandAssaults } from './assault.ts';
import { expandNeutral } from './expand.ts';
import { AXIS_REFRESH_S, OFFENSIVE_STALL_TICKS, TICKS_PER_S } from '../balance.ts';
import {
  continueStrike,
  refreshStrike,
  reshuffleStrike,
  releaseDirection,
} from '../commands/launch.ts';
import { placeFront } from '../commands/plan.ts';
import { armyPieces } from '../commands/scope.ts';
import { onSeaMission } from '../queries/unit-view.ts';
import type { MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

// Фронт направления — не «едущая» линия, а сама граница с целью: любая смена владельца гекса
// пересчитывает его целиком и точно. Лишних граней, которые потом надо было бы исправлять, нет.
function syncFronts(state: MatchState): void {
  state.plans.forEach((plan, i) => {
    if (plan.kind !== 'front' || plan.derived === undefined) return;
    if (plan.rev === state.supplyRevision) return;
    const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
    if (owner === undefined) return;
    const army = state.armies.find((a) => a.id === plan.armyId);
    const edges = army?.dir ? armyPieces(state, army).flat() : [];
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
  // Десант высадился (ни на воде, ни путей через воду) — приказ вторжения исполнен.
  for (const army of state.armies) {
    if (army.invading !== true) continue;
    if (!allUnits(state).some((u) => u.armyId === army.id && onSeaMission(state, u))) {
      delete army.invading;
    }
  }
  for (const army of [...state.armies]) {
    const dir = army.dir;
    if (!dir || dir.mode === 'idle') continue;
    if (dir.target < 0) {
      if (dir.mode === 'attack') expandNeutral(state, army);
      continue;
    }
    if (state.players[dir.target]?.status !== 'alive') {
      releaseDirection(state, army);
      continue;
    }
    // Временная оборона после застоя: время пришло — снова наступаем.
    if (dir.mode === 'hold' && dir.resume !== undefined && state.tick >= dir.resume) {
      army.dir = { target: dir.target, mode: 'attack', ...(dir.bloc ? { bloc: true } : {}) };
      continueStrike(state, army);
      continue;
    }
    const first = state.plans.find((p) => p.armyId === army.id);
    // Наступление встало надолго — командир меняет оси или уходит во временную оборону.
    if (
      dir.mode === 'attack' &&
      first?.kind === 'front' &&
      first.offensive?.active &&
      state.tick - first.offensive.progressTick > OFFENSIVE_STALL_TICKS &&
      !allUnits(state).some((u) => u.armyId === army.id && u.inBattle)
    ) {
      reshuffleStrike(state, army);
      continue;
    }
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
    const edges = armyPieces(state, army).flat();
    if (edges.length > 0) placeFront(state, army.id, edges, dir.target);
  }
}
