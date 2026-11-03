import type { Command, PlayerView } from '@hexfront/sim';

import type { ControlGroups } from './control-groups.ts';
import type { Picked } from '../dev/sandbox-selection.ts';

/** Что реестру горячих клавиш нужно от страницы матча; обе страницы передают свои ссылки. */
export interface HotkeyContext {
  /** Гекс последнего события ленты или null. */
  latestEventHex(): number | null;
  centerOnHex(hex: number): void;
  /** Отмена жеста карты. */
  cancelMap(): void;
  toolActive(): boolean;
  /** Выключает инструмент плана и сбрасывает его жест. */
  cancelTool(): void;
  clearPick(): void;
  view(): PlayerView | null;
  picked(): Picked;
  selectedArmy(): number | null;
  setArmy(id: number | null): void;
  send(cmd: Command): void;
  groups: ControlGroups;
  /** Выбирает отряды на карте. */
  selectUnits(ids: readonly number[]): void;
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function cycleArmy(ctx: HotkeyContext, step: 1 | -1): boolean {
  const armies = [...(ctx.view()?.armies ?? [])].sort((a, b) => a.number - b.number);
  if (armies.length === 0) return false;
  const index = armies.findIndex((army) => army.id === ctx.selectedArmy());
  const next = armies[(index + step + armies.length) % armies.length];
  if (!next) return false;
  ctx.setArmy(next.id);
  return true;
}

function centerOnSelection(ctx: HotkeyContext): boolean {
  const picked = ctx.picked();
  const unit = ctx.view()?.units.find((u) => picked.units.includes(u.id));
  const hex = unit?.hex ?? picked.hex;
  if (hex === null || hex === undefined) return false;
  ctx.centerOnHex(hex);
  return true;
}

function stopSelected(ctx: HotkeyContext): boolean {
  const unitIds = ownPicked(ctx);
  if (unitIds.length === 0) return false;
  ctx.send({ t: 'stop', unitIds });
  return true;
}

function ownPicked(ctx: HotkeyContext): number[] {
  const view = ctx.view();
  if (!view) return [];
  return view.units
    .filter((u) => u.owner === view.playerId && ctx.picked().units.includes(u.id))
    .map((u) => u.id);
}

// Shift+1…9 запоминает выбранные свои отряды, 1…9 вызывает; повтор подряд центрирует камеру.
function controlGroup(ctx: HotkeyContext, digit: number, store: boolean): boolean {
  if (store) {
    const ids = ownPicked(ctx);
    ctx.groups.store(digit, ids);
    return ids.length > 0;
  }
  const view = ctx.view();
  if (!view) return false;
  const own = new Set(view.units.filter((u) => u.owner === view.playerId).map((u) => u.id));
  const { units, repeat } = ctx.groups.recall(digit, own);
  if (units.length === 0) return false;
  ctx.selectUnits(units);
  const first = view.units.find((u) => units.includes(u.id));
  if (repeat && first) ctx.centerOnHex(first.hex);
  return true;
}

function escape(ctx: HotkeyContext): void {
  ctx.cancelMap();
  if (ctx.toolActive()) ctx.cancelTool();
  else ctx.clearPick();
}

/**
 * Единый обработчик `keydown` матча: Esc, Space, Tab/Shift+Tab, C, Delete, группы 1–9.
 * Ввод в полях и сочетания с Ctrl/Meta/Alt не перехватываются.
 */
export function createHotkeyHandler(ctx: HotkeyContext): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTextTarget(e.target)) return;
    let handled = false;
    if (e.key === 'Escape') {
      escape(ctx);
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      const hex = ctx.latestEventHex();
      if (hex !== null) {
        ctx.centerOnHex(hex);
        handled = true;
      }
    } else if (e.key === 'Tab') handled = cycleArmy(ctx, e.shiftKey ? -1 : 1);
    else if (e.code === 'KeyC' && !e.repeat) handled = centerOnSelection(ctx);
    else if (e.key === 'Delete') handled = stopSelected(ctx);
    else if (/^Digit[1-9]$/u.test(e.code) && !e.repeat)
      handled = controlGroup(ctx, Number(e.code.slice(5)), e.shiftKey);
    if (handled) e.preventDefault();
  };
}
