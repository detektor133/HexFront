import type { PlayerView } from '@hexfront/sim';

export const ONBOARDING_HINTS = ['tax', 'foundCity', 'front', 'offensive'] as const;

export type OnboardingHintId = (typeof ONBOARDING_HINTS)[number];

export interface OnboardingState {
  readonly canChangeTax: boolean;
  readonly canFoundCity: boolean;
  readonly canAssignFront: boolean;
  readonly canStartOffensive: boolean;
}

export function onboardingState(view: PlayerView): OnboardingState {
  const player = view.players.find((item) => item.id === view.playerId);
  const hasEnemy = view.units.some((unit) => unit.owner !== view.playerId);
  const hasFront = view.plans.some((plan) => plan.kind === 'front');
  const hasOffensive = view.plans.some(
    (plan) => plan.kind === 'front' && (plan.offensive !== null || plan.startWanted),
  );
  const hasFreeOwnHex = view.hexes.owner.some((owner, hex) => {
    if (owner !== view.playerId) return false;
    return !view.cities.some((city) => city.hex === hex);
  });
  return {
    canChangeTax: player !== undefined,
    canFoundCity: player !== undefined && player.gold >= view.me.foundCityCost && hasFreeOwnHex,
    canAssignFront: hasEnemy && view.armies.length > 0 && !hasFront,
    canStartOffensive: hasFront && !hasOffensive,
  };
}

export function availableOnboardingHints(
  state: OnboardingState,
  dismissed: ReadonlySet<OnboardingHintId>,
): OnboardingHintId[] {
  const available: Record<OnboardingHintId, boolean> = {
    tax: state.canChangeTax,
    foundCity: state.canFoundCity,
    front: state.canAssignFront,
    offensive: state.canStartOffensive,
  };
  return ONBOARDING_HINTS.filter((id) => available[id] && !dismissed.has(id));
}
