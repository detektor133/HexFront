import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FP, type Fp } from '@hexfront/sim';

import { createLocalEngine, HUMAN_ID } from '../src/local/engine.ts';
import type { FromWorker } from '../src/local/messages.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function engine() {
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  return e;
}

function asView(msg: FromWorker): Extract<FromWorker, { t: 'view' }> {
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return msg;
}

describe('локальный режим', () => {
  it('каждый тик отдаёт снимок игрока-человека', () => {
    const msg = asView(engine().tick());
    expect(msg.view.tick).toBe(1);
    expect(msg.view.playerId).toBe(HUMAN_ID);
  });

  it('команды игрока применяются в следующем тике, отказы возвращаются', () => {
    const e = engine();
    e.queue({ t: 'setTax', rate: 400 as Fp });
    e.queue({ t: 'foundCity', hex: 0 });
    const msg = asView(e.tick());
    expect(msg.view.players[HUMAN_ID]?.taxTarget).toBe(400);
    expect(msg.rejected).toEqual([{ command: 'foundCity', reason: 'notOwnHex' }]);
    expect(asView(e.tick()).rejected).toEqual([]);
  });

  it('выбранный гекс: карточка города и проверки кнопок', () => {
    const e = engine();
    const capital = e.state.cities.find((c) => c.owner === HUMAN_ID);
    e.select(capital?.hex ?? -1);
    const msg = asView(e.tick());
    expect(msg.selection?.city?.isCapital).toBe(true);
    expect(msg.selection?.foundCity).toMatchObject({ ok: false, reason: 'isCity' });
  });

  it('армии с auto всех игроков ведёт commander; ручная команда игрока выключает auto (CR-006)', () => {
    const e = engine();
    const owned = (p: number): number => e.state.hexes.owner.filter((o) => o === p).length;
    const before = [owned(0), owned(1)];
    for (let i = 0; i < 300; i += 1) e.tick();
    expect(owned(0)).toBeGreaterThan(before[0] ?? 0);
    expect(owned(1)).toBeGreaterThan(before[1] ?? 0);
    const army = e.state.armies.find((a) => a.owner === HUMAN_ID);
    const unit = e.state.units.find((u) => u.armyId === army?.id);
    e.queue({ t: 'move', unitIds: [unit?.id ?? -1], to: unit?.hex ?? 0 });
    e.tick();
    expect(e.state.armies.find((a) => a.id === army?.id)?.auto).toBe(false);
  });

  it('ручной приказ или деление → auto выключен, commander армию больше не трогает (04/T22a)', () => {
    for (const manual of ['split', 'move'] as const) {
      const e = engine();
      const [unit] = e.state.units.filter((u) => u.owner === HUMAN_ID);
      if (!unit) throw new Error('нет стартового отряда');
      // Первый тик — ход commander игрока 0: ручное действие в том же тике побеждает.
      if (manual === 'split') e.queue({ t: 'split', unitId: unit.id, soldiers: (50 * FP) as Fp });
      else e.queue({ t: 'move', unitIds: [unit.id], to: unit.hex });
      e.tick();
      const army = e.state.armies.find((a) => a.owner === HUMAN_ID);
      expect(army?.auto).toBe(false);
      const ids = e.state.units.filter((u) => u.armyId === army?.id).map((u) => u.id);
      for (let i = 0; i < 100; i += 1) {
        e.tick();
        const moved = e.state.units.filter((u) => ids.includes(u.id) && u.path.length > 0);
        expect(moved, `тик ${e.state.tick}`).toEqual([]);
      }
    }
  });

  it('боты — все, кроме человека: у них мозг бота, у человека — нет (04/T24)', () => {
    const e = createLocalEngine(small, 42, 3);
    if ('errors' in e) throw new Error(e.errors.join(' '));
    for (let i = 0; i < 30; i += 1) e.tick();
    // Мозг бота включает автопополнение; человек его не трогал.
    expect(e.state.players.map((p) => p.autoReinforce)).toEqual([false, true, true]);
  });

  it('режим наблюдения: человек тоже под ботом (04/T24)', () => {
    const e = createLocalEngine(small, 42, 3, [0, 1, 2]);
    if ('errors' in e) throw new Error(e.errors.join(' '));
    for (let i = 0; i < 30; i += 1) e.tick();
    expect(e.state.players.map((p) => p.autoReinforce)).toEqual([true, true, true]);
  });

  it('снимок показывает победителя (04/T24)', () => {
    const e = engine();
    const before = asView(e.tick()).view;
    expect(before.winner).toBe(-1);
    e.state.winner = 1;
    expect(asView(e.tick()).view.winner).toBe(1);
  });

  it('ошибка карты возвращается, а не бросается', () => {
    expect(createLocalEngine({ version: 2 }, 1, 2)).toMatchObject({ errors: expect.any(Array) });
  });
});
