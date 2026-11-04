import type { PlayerView } from '@hexfront/sim';

/** Порядок подсказок: сначала экономика и рост, затем война, затем снабжение. */
export const ONBOARDING_HINTS = ['expand', 'tax', 'foundCity', 'attack', 'hold', 'depot'] as const;

export type OnboardingHintId = (typeof ONBOARDING_HINTS)[number];

export interface OnboardingState {
  readonly canExpand: boolean;
  readonly canChangeTax: boolean;
  readonly canFoundCity: boolean;
  readonly canAttack: boolean;
  readonly canHold: boolean;
  readonly canBuildDepot: boolean;
}

export function onboardingState(view: PlayerView): OnboardingState {
  const player = view.players.find((item) => item.id === view.playerId);
  const hasForeignLand = view.hexes.owner.some((owner) => owner >= 0 && owner !== view.playerId);
  const hasFreeOwnHex = view.hexes.owner.some((owner, hex) => {
    if (owner !== view.playerId) return false;
    return !view.cities.some((city) => city.hex === hex);
  });
  return {
    canExpand: player !== undefined && view.armies.length > 0,
    canChangeTax: player !== undefined,
    canFoundCity: player !== undefined && player.gold >= view.me.foundCityCost && hasFreeOwnHex,
    canAttack: hasForeignLand && view.armies.length > 0,
    canHold: hasForeignLand && view.armies.length > 0,
    canBuildDepot: view.armies.length > 0 && hasFreeOwnHex,
  };
}

export function availableOnboardingHints(
  state: OnboardingState,
  dismissed: ReadonlySet<OnboardingHintId>,
): OnboardingHintId[] {
  const available: Record<OnboardingHintId, boolean> = {
    expand: state.canExpand,
    tax: state.canChangeTax,
    foundCity: state.canFoundCity,
    attack: state.canAttack,
    hold: state.canHold,
    depot: state.canBuildDepot,
  };
  return ONBOARDING_HINTS.filter((id) => available[id] && !dismissed.has(id));
}
