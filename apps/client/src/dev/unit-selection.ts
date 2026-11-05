import type { PlayerView } from '@hexfront/sim';

import { NOTHING_PICKED, selectUnits, type Picked } from './sandbox-selection.ts';
import type { UnitLayer } from './unit-layer.ts';
import type { Point } from '../render/hex-geometry.ts';

export interface PickedState {
  current: Picked;
}

export function createPickedState(): PickedState {
  return { current: NOTHING_PICKED };
}

export function commitPickedState(
  state: PickedState,
  picked: Picked,
  notify: (picked: Picked) => void,
): void {
  state.current = picked;
  notify(picked);
}

export function createSandboxPicker(
  state: PickedState,
  notify: (picked: Picked) => void,
  afterPick: (picked: Picked, previous: Picked) => void = () => undefined,
): (picked: Picked) => void {
  return (picked) => {
    const previous = state.current;
    commitPickedState(state, picked, notify);
    afterPick(picked, previous);
  };
}

/** Обрабатывает попадание в фишку и обновляет состояние выбора владельца карты. */
export function tapUnit(
  world: Point,
  view: PlayerView,
  picked: Picked,
  layer: Pick<UnitLayer, 'unitsAt'>,
): Picked | null {
  const hit = layer.unitsAt(world);
  return hit.length > 0 ? selectUnits(view, picked, hit) : null;
}
