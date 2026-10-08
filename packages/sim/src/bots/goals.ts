// Цели utility AI бота: fixed-point оценки и стабильный порядок кандидатов.
// GDD: docs/gdd/09-bots.md — «Utility AI».
import {
  BOT_ATTACK_MIN_RATIO,
  BOT_ATTACK_STOP_RATIO,
  BOT_ARMY_RATIO,
  BOT_ELIM_BONUS,
  BOT_ELIM_CITIES,
  BOT_GOLD_TARGET,
  BOT_RATIO_CAP,
  BOT_TARGET_STICKY,
  BOT_W_ATTACK,
  BOT_W_DEFEND,
  BOT_W_FORT,
  BOT_W_FOUND,
  BOT_W_IMPROVE,
  BOT_W_RECRUIT,
  BOT_W_ROAD,
  BOT_W_UPGRADE,
  CITY_UPGRADE_COST,
} from '../balance.ts';
import { FP, clamp, fpDiv, fpMul, intDiv, type Fp } from '../math/int.ts';

const ONE = FP as Fp;

export type BotGoal =
  'road' | 'defend' | 'attack' | 'recruit' | 'found' | 'upgrade' | 'improve' | 'fort';

export interface GoalCandidate {
  readonly kind: BotGoal;
  readonly utility: Fp;
  readonly id: number;
}

const GOAL_ORDER: Readonly<Record<BotGoal, number>> = {
  road: 0,
  defend: 1,
  attack: 2,
  recruit: 3,
  found: 4,
  upgrade: 5,
  improve: 6,
  fort: 7,
};

/** Умножает вес цели на фактор 0..1 в fixed-point. */
export function utility(weight: Fp, factor: Fp): Fp {
  return fpMul(weight, clamp(factor, 0 as Fp, ONE));
}

/** Давление накопленного золота относительно цели, доля 0..1. */
export function pressure(gold: Fp): Fp {
  if (gold <= BOT_GOLD_TARGET) return 0 as Fp;
  return clamp(fpDiv((gold - BOT_GOLD_TARGET) as Fp, BOT_GOLD_TARGET), 0 as Fp, ONE);
}

/** Полезность дороги: единица, если существует подходящий изолированный город. */
export function roadUtility(hasRoadTarget: boolean): Fp {
  return hasRoadTarget ? utility(BOT_W_ROAD, ONE) : (0 as Fp);
}

/** Потребность обороны: `clamp01((theirs × BOT_ARMY_RATIO − mine) / theirs)`. */
export function defenseNeed(theirs: Fp, mine: Fp): Fp {
  if (theirs <= 0) return 0 as Fp;
  const desired = fpMul(theirs, BOT_ARMY_RATIO);
  if (desired <= mine) return 0 as Fp;
  return clamp(fpDiv((desired - mine) as Fp, theirs), 0 as Fp, ONE);
}

/** Полезность обороны по готовому фактору потребности. */
export function defendUtility(need: Fp): Fp {
  return utility(BOT_W_DEFEND, need);
}

/** Полезность набора по максимальному фактору нужды. */
export function recruitUtility(need: Fp, attackNeed: Fp, goldPressure: Fp): Fp {
  return utility(BOT_W_RECRUIT, Math.max(need, attackNeed, goldPressure) as Fp);
}

/** Полезность наступления с бонусами слабого противника и текущей цели. */
export function attackUtility(
  mine: Fp,
  theirs: Fp,
  enemyCities: number,
  isCurrentTarget: boolean,
): Fp {
  if (theirs <= 0) return 0 as Fp;
  const ratio = Math.min(fpDiv(mine, theirs), BOT_RATIO_CAP) as Fp;
  if (ratio < BOT_ATTACK_MIN_RATIO || (isCurrentTarget && ratio < BOT_ATTACK_STOP_RATIO)) {
    return 0 as Fp;
  }
  const factor = fpDiv(
    (ratio - BOT_ATTACK_MIN_RATIO) as Fp,
    (BOT_RATIO_CAP - BOT_ATTACK_MIN_RATIO) as Fp,
  );
  const elimination = enemyCities <= BOT_ELIM_CITIES ? ((ONE + BOT_ELIM_BONUS) as Fp) : ONE;
  const sticky = isCurrentTarget ? ((ONE + BOT_TARGET_STICKY) as Fp) : ONE;
  return fpMul(fpMul(fpMul(BOT_W_ATTACK, factor), elimination), sticky);
}

/** Полезность основания города с учётом pressure. */
export function foundUtility(popRatio: Fp, goldPressure: Fp): Fp {
  return fpMul(utility(BOT_W_FOUND, popRatio), (ONE + goldPressure) as Fp);
}

/** Полезность улучшения города с учётом его текущего уровня и pressure. */
export function upgradeUtility(level: number, goldPressure: Fp): Fp {
  const remaining = CITY_UPGRADE_COST.length + 1 - level;
  if (remaining <= 0) return 0 as Fp;
  const levelFactor = intDiv(remaining * FP, CITY_UPGRADE_COST.length) as Fp;
  return fpMul(utility(BOT_W_UPGRADE, levelFactor), (ONE + goldPressure) as Fp);
}

/** Полезность благоустройства с учётом населения и pressure. */
export function improveUtility(popRatio: Fp, goldPressure: Fp): Fp {
  return fpMul(utility(BOT_W_IMPROVE, popRatio), (ONE + goldPressure) as Fp);
}

/** Полезность форта по потребности обороны и pressure. */
export function fortUtility(need: Fp, goldPressure: Fp): Fp {
  return fpMul(fpMul(BOT_W_FORT, need), goldPressure);
}

/** Сортирует кандидатов по utility, строке таблицы целей и id. */
export function rankGoals(goals: readonly GoalCandidate[]): GoalCandidate[] {
  return [...goals].sort(
    (a, b) => b.utility - a.utility || GOAL_ORDER[a.kind] - GOAL_ORDER[b.kind] || a.id - b.id,
  );
}
