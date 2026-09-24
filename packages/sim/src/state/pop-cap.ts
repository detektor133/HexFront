// Лимит населения гекса. GDD: docs/gdd/02-economy.md — «Лимит».
import {
  BASE_POP_CAP,
  CITY_POP_CAP_PER_LEVEL,
  FERTILE_CAP_MULT,
  IMPROVEMENT_CAP_STEP,
} from '../balance.ts';
import type { MatchState } from './types.ts';
import { FEATURE, TERRAIN_NAMES } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import { FP, fpMul, type Fp } from '../math/int.ts';

/**
 * Лимит населения обычного гекса:
 * popCap = baseCap(terrain) × featureMult × (1 + IMPROVEMENT_CAP_STEP × improvement).
 * @returns fixed-point людей; 0 для воды
 */
export function hexPopCap(state: MatchState, hex: HexId): Fp {
  const name = TERRAIN_NAMES[state.map.terrain[hex] ?? 0];
  if (name === undefined || name === 'water') return 0 as Fp;
  const feature = state.map.features[hex] === FEATURE.fertile ? FERTILE_CAP_MULT : (FP as Fp);
  const improvement = (FP + IMPROVEMENT_CAP_STEP * (state.hexes.improvement[hex] ?? 0)) as Fp;
  return fpMul(fpMul(BASE_POP_CAP[name], feature), improvement);
}

/**
 * Лимит населения городского гекса: CITY_POP_CAP × level.
 * @returns fixed-point людей
 */
export function cityPopCap(level: number): Fp {
  return (CITY_POP_CAP_PER_LEVEL * level) as Fp;
}
