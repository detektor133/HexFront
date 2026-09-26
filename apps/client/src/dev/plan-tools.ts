// Ввод инструментов планов (CR-004, как в HoI4): росчерк пальцем/ЛКМ — отпустил, приказ отдан;
// тап — фронт по грани или по всему куску границы с врагом, «Удалить» — линия под пальцем;
// ПКМ или долгий тап — отмена инструмента; ручки на концах фронта выбранной армии тянут участок.
import type { Command } from '@hexfront/sim';

import {
  dragFrontEnd,
  finishCommand,
  frontHandles,
  startDraft,
  strokeAdd,
  tapCommand,
  type Draft,
  type DraftContext,
  type Tool,
} from './plan-draft.ts';
import type { Point } from '../render/hex-geometry.ts';
import type { StrokeHandler, TapKind } from '../render/map-view.ts';

/** Включённый инструмент: какой и для какой армии. */
export interface ToolState {
  readonly tool: Tool;
  readonly armyId: number;
}

export interface PlanInputDeps {
  context(): DraftContext | null;
  tool(): ToolState | null;
  selected(): number | null;
  setTool(t: ToolState | null): void;
  setDraft(d: Draft | null): void;
  send(cmd: Command): void;
}

export interface PlanInput {
  readonly stroke: StrokeHandler;
  /** Тап при включённом инструменте; true — тап обработан (выбор на карте не меняется). */
  tap(world: Point, kind: TapKind): boolean;
  grab(world: Point): StrokeHandler | null;
}

/** Доля радиуса гекса: насколько близко к ручке надо нажать, чтобы её взять. */
const HANDLE_HIT = 0.45;

/** Создаёт обработчики ввода инструментов планов. */
export function createPlanInput(deps: PlanInputDeps): PlanInput {
  let draft: Draft | null = null;
  const show = (d: Draft | null): void => {
    draft = d;
    deps.setDraft(d);
  };
  const stroke: StrokeHandler = (world, phase) => {
    const t = deps.tool();
    const c = deps.context();
    if (!t || !c) return;
    if (phase === 'start') show(startDraft(t.tool, t.armyId));
    if (phase === 'cancel') return show(null);
    if (!draft) return;
    const next = strokeAdd(c, draft, world);
    if (next !== draft) show(next);
    if (phase !== 'end') return;
    const cmd = draft ? finishCommand(draft) : null;
    if (cmd) deps.send(cmd);
    show(null);
    deps.setTool(null);
  };
  return {
    stroke,
    tap(world, kind) {
      const t = deps.tool();
      if (!t) return false;
      if (kind === 'order') {
        show(null);
        deps.setTool(null);
        return true;
      }
      const c = deps.context();
      const cmd = c ? tapCommand(c, startDraft(t.tool, t.armyId), world) : null;
      if (cmd) {
        deps.send(cmd);
        deps.setTool(null);
      }
      return true;
    },
    grab(world) {
      const c = deps.context();
      const armyId = deps.selected();
      if (deps.tool() || !c || armyId === null) return null;
      const plan = c.view.plans.find((p) => p.armyId === armyId);
      if (plan?.kind !== 'front') return null;
      const which = frontHandles(c, plan).findIndex(
        (p) => Math.hypot(p.x - world.x, p.y - world.y) <= c.radius * HANDLE_HIT,
      );
      if (which < 0) return null;
      const base = [...plan.edges];
      return (w, phase) => {
        if (phase === 'cancel') return show(null);
        const edges = dragFrontEnd(c, base, which === 0 ? 0 : 1, w);
        if (phase !== 'end') return show({ tool: 'front', armyId, edges, hexes: [] });
        deps.send({ t: 'assignFront', armyId, edges });
        show(null);
      };
    },
  };
}
