import type { Command, PlayerView, UnitView } from '@hexfront/sim';

import { armyName } from './army-name.ts';
import type { Point } from '../render/hex-geometry.ts';

export type RadialActionKind = 'merge' | 'assignUnits' | 'bombard';

export interface RadialAction {
  readonly kind: RadialActionKind;
  readonly command?: Command;
  readonly label: string;
  readonly children?: readonly RadialAction[];
}

export interface RadialMenuState {
  readonly center: Point;
  readonly actions: readonly RadialAction[];
  readonly active: readonly RadialAction[];
}

export function buildRadialActions(
  units: readonly UnitView[],
  view: PlayerView,
): readonly RadialAction[] {
  const [first] = units;
  const ids = units.map((unit) => unit.id);
  const actions: RadialAction[] = [];
  const sameStack =
    units.length > 1 && units.every((unit) => unit.hex === first?.hex && unit.type === first?.type);
  if (sameStack) {
    actions.push({ kind: 'merge', command: { t: 'merge', unitIds: ids }, label: 'unit.merge' });
  }
  actions.push({
    kind: 'assignUnits',
    label: 'unit.toArmy',
    children: [
      ...view.armies.map((army) => ({
        kind: 'assignUnits' as const,
        command: { t: 'assignUnits' as const, unitIds: ids, armyId: army.id },
        label: armyName(army),
      })),
      {
        kind: 'assignUnits' as const,
        command: { t: 'assignUnits' as const, unitIds: ids, armyId: null },
        label: 'army.reserve',
      },
    ],
  });
  if (units.length === 1 && first?.type === 'artillery') {
    actions.push({
      kind: 'bombard',
      command: { t: 'bombard', unitId: first.id, targetUnitId: null },
      label: 'unit.autoTarget',
    });
  }
  return actions;
}

export function sectorAt(
  state: RadialMenuState,
  point: Point,
  radius: number = 88,
): RadialAction | null {
  const dx = point.x - state.center.x;
  const dy = point.y - state.center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < radius * 0.35 || distance > radius * 1.35 || state.active.length === 0)
    return null;
  const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  const index = Math.floor((angle / (Math.PI * 2)) * state.active.length);
  return state.active[Math.min(index, state.active.length - 1)] ?? null;
}

export function sectorCenter(state: RadialMenuState, index: number, radius: number = 88): Point {
  const angle = -Math.PI / 2 + ((index + 0.5) / state.active.length) * Math.PI * 2;
  return {
    x: state.center.x + Math.cos(angle) * radius,
    y: state.center.y + Math.sin(angle) * radius,
  };
}
