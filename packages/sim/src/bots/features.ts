import type { BotAction } from './actions.ts';
import { fpMul, type Fp } from '../math/int.ts';

export type BotContextName = 'threat' | 'goldSeconds' | 'neutralBorderShare';

export interface ActionFeatureContext {
  readonly threat: Fp;
  readonly goldSeconds: Fp;
  readonly neutralBorderShare: Fp;
}

export type ActionFeatures = Readonly<Record<string, Fp>>;

/**
 * Строит признаки из эффектов варианта и трёх контекстов снимка.
 * @returns признаки в масштабе fixed-point (1000 = 1,0)
 */
export function actionFeatures(action: BotAction, context: ActionFeatureContext): ActionFeatures {
  const features: Record<string, Fp> = {
    threat: context.threat,
    goldSeconds: context.goldSeconds,
    neutralBorderShare: context.neutralBorderShare,
  };
  const contexts: readonly [BotContextName, Fp][] = [
    ['threat', context.threat],
    ['goldSeconds', context.goldSeconds],
    ['neutralBorderShare', context.neutralBorderShare],
  ];
  for (const [effect, value] of Object.entries(action.effects)) {
    features[effect] = value;
    for (const [name, contextValue] of contexts) {
      features[`${effect}*${name}`] = fpMul(value, contextValue);
    }
  }
  return features;
}
