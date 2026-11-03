// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { PlayerView } from '@hexfront/sim';

import { createHotkeyHandler, type HotkeyContext } from '../src/input/hotkeys.ts';

const view = {
  playerId: 0,
  armies: [
    { id: 11, number: 2 },
    { id: 10, number: 1 },
  ],
  units: [
    { id: 1, owner: 0, hex: 7 },
    { id: 2, owner: 1, hex: 8 },
  ],
} as unknown as PlayerView;

function setup(overrides: Partial<HotkeyContext> = {}) {
  const ctx = {
    latestEventHex: () => 5,
    centerOnHex: vi.fn(),
    cancelMap: vi.fn(),
    toolActive: () => false,
    cancelTool: vi.fn(),
    clearPick: vi.fn(),
    view: () => view,
    picked: () => ({ hex: null, units: [1, 2], target: null }),
    selectedArmy: () => 10,
    setArmy: vi.fn(),
    send: vi.fn(),
    ...overrides,
  } satisfies HotkeyContext;
  const handler = createHotkeyHandler(ctx);
  const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    handler(event);
    return event;
  };
  return { ctx, press };
}

describe('07/T17dc: реестр горячих клавиш', () => {
  it('Esc: жест карты, затем инструмент, иначе снятие выбора', () => {
    const idle = setup();
    idle.press({ key: 'Escape' });
    expect(idle.ctx.cancelMap).toHaveBeenCalled();
    expect(idle.ctx.clearPick).toHaveBeenCalled();
    const tool = setup({ toolActive: () => true });
    tool.press({ key: 'Escape' });
    expect(tool.ctx.cancelTool).toHaveBeenCalled();
    expect(tool.ctx.clearPick).not.toHaveBeenCalled();
  });

  it('Space центрирует на событии ленты, без события ничего не делает', () => {
    const { ctx, press } = setup();
    expect(press({ code: 'Space', key: ' ' }).defaultPrevented).toBe(true);
    expect(ctx.centerOnHex).toHaveBeenCalledWith(5);
    const none = setup({ latestEventHex: () => null });
    none.press({ code: 'Space', key: ' ' });
    expect(none.ctx.centerOnHex).not.toHaveBeenCalled();
  });

  it('Tab и Shift+Tab переключают армии по номеру по кругу', () => {
    const { ctx, press } = setup();
    press({ key: 'Tab' });
    expect(ctx.setArmy).toHaveBeenLastCalledWith(11);
    press({ key: 'Tab', shiftKey: true });
    expect(ctx.setArmy).toHaveBeenLastCalledWith(11);
    const second = setup({ selectedArmy: () => 11 });
    second.press({ key: 'Tab' });
    expect(second.ctx.setArmy).toHaveBeenLastCalledWith(10);
  });

  it('C центрирует на выбранном отряде, Delete останавливает только свои', () => {
    const { ctx, press } = setup();
    press({ code: 'KeyC', key: 'c' });
    expect(ctx.centerOnHex).toHaveBeenCalledWith(7);
    press({ key: 'Delete' });
    expect(ctx.send).toHaveBeenCalledExactlyOnceWith({ t: 'stop', unitIds: [1] });
  });

  it('без выбора команд нет; поля ввода и Ctrl/Meta/Alt игнорируются', () => {
    const empty = setup({ picked: () => ({ hex: null, units: [], target: null }) });
    empty.press({ key: 'Delete' });
    empty.press({ code: 'KeyC', key: 'c' });
    expect(empty.ctx.send).not.toHaveBeenCalled();
    expect(empty.ctx.centerOnHex).not.toHaveBeenCalled();
    const { ctx, press } = setup();
    press({ key: 'Delete' }, document.createElement('input'));
    press({ key: 'Escape' }, document.createElement('textarea'));
    press({ key: 'Tab', ctrlKey: true });
    press({ key: 'Delete', metaKey: true });
    press({ code: 'KeyC', key: 'c', altKey: true });
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.cancelMap).not.toHaveBeenCalled();
    expect(ctx.setArmy).not.toHaveBeenCalled();
    expect(ctx.centerOnHex).not.toHaveBeenCalled();
  });
});
