import type { Command, PlayerView } from '@hexfront/sim';

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
  const view = ctx.view();
  if (!view) return false;
  const unitIds = view.units
    .filter((u) => u.owner === view.playerId && ctx.picked().units.includes(u.id))
    .map((u) => u.id);
  if (unitIds.length === 0) return false;
  ctx.send({ t: 'stop', unitIds });
  return true;
}

function escape(ctx: HotkeyContext): void {
  ctx.cancelMap();
  if (ctx.toolActive()) ctx.cancelTool();
  else ctx.clearPick();
}

/**
 * Единый обработчик `keydown` матча: Esc, Space, Tab/Shift+Tab, C, Delete.
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
    if (handled) e.preventDefault();
  };
}
