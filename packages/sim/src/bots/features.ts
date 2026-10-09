import type { BotAction } from './actions.ts';
import { fp, fpDiv, fpMul, type Fp } from '../math/int.ts';

export interface ActionFeatureContext {
  readonly gold: Fp;
  readonly incomePerS: Fp;
  readonly upkeepPerS: Fp;
  readonly strength: Fp;
  readonly threat: Fp;
  readonly goldReserve: Fp;
  readonly neutralBorderShare: Fp;
  readonly ownSoldiers: Fp;
  readonly enemySoldiers: Fp;
  readonly enemyCities: number;
}

export interface ActionFeatures {
  readonly effectGold: Fp;
  readonly effectUpkeep: Fp;
  readonly effectIncome: Fp;
  readonly effectStrength: Fp;
  readonly effectDefense: Fp;
  readonly effectSupply: Fp;
  readonly threat: Fp;
  readonly goldReserve: Fp;
  readonly neutralBorderShare: Fp;
  readonly effectStrengthThreat: Fp;
  readonly effectDefenseThreat: Fp;
  readonly frontRatio: Fp;
  readonly enemyCities: Fp;
}

const ratio = (value: Fp, current: Fp): Fp => (current === 0 ? (0 as Fp) : fpDiv(value, current));

/**
 * Считает fixed-point признаки действия и их произведения с контекстами снимка.
 * @returns признаки в масштабе fixed-point (1000 = 1,0)
 */
export function actionFeatures(action: BotAction, context: ActionFeatureContext): ActionFeatures {
  const effectGold = ratio(-action.costGold as Fp, context.gold);
  const effectUpkeep = ratio(-action.upkeepGoldPerS as Fp, context.upkeepPerS);
  const effectIncome = ratio(action.incomeGoldPerS, context.incomePerS);
  const effectStrength = ratio(action.strength, context.strength);
  const effectDefense = ratio(action.defense, context.ownSoldiers);
  const effectSupply = ratio(action.supply, context.enemySoldiers);
  const frontRatio = ratio(
    context.ownSoldiers,
    (context.ownSoldiers + context.enemySoldiers) as Fp,
  );
  const enemyCities = fpDiv(fp(1), (fp(1) + fp(context.enemyCities)) as Fp);
  return {
    effectGold,
    effectUpkeep,
    effectIncome,
    effectStrength,
    effectDefense,
    effectSupply,
    threat: context.threat,
    goldReserve: context.goldReserve,
    neutralBorderShare: context.neutralBorderShare,
    effectStrengthThreat: fpMul(effectStrength, context.threat),
    effectDefenseThreat: fpMul(effectDefense, context.threat),
    frontRatio,
    enemyCities,
  };
}
