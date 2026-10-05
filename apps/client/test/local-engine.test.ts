import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FP, type Fp } from '@hexfront/sim';

import { createLocalEngine, HUMAN_ID } from '../src/local/engine.ts';
import type { FromWorker } from '../src/local/messages.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function engine(fog = false) {
  const e = createLocalEngine(small, 42, 2, undefined, fog);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  return e;
}

function asView(msg: FromWorker): Extract<FromWorker, { t: 'view' }> {
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return msg;
}

describe('локальный режим', () => {
  it('замороженная последовательность сохраняет fog, selection и tick до ack', () => {
    const old = engine(true);
    old.tick();
    old.setObserver(null);
    const oldLast = old.tick();
    const oldFog = oldLast.view.hexes.visible.some((value) => value === 0);
    old.setFog(false);
    old.select(0);

    const current = engine(true);
    const currentInitial = current.snapshot();
    current.setObserver(null);
    current.setFog(false);
    current.select(0);
    const currentLast = current.snapshot();

    expect({
      old: {
        tick: oldLast.view.tick,
        fog: oldFog,
        selection: oldLast.selection?.hex ?? null,
      },
      current: {
        initialTick: currentInitial.view.tick,
        tick: currentLast.view.tick,
        fog: currentLast.view.hexes.visible.every((value) => value === 1),
        selection: currentLast.selection?.hex ?? null,
      },
    }).toEqual({
      old: { tick: 2, fog: true, selection: null },
      current: { initialTick: 0, tick: 0, fog: true, selection: 0 },
    });
  });

  it('каждый тик отдаёт снимок игрока-человека', () => {
    const msg = asView(engine().tick());
    expect(msg.view.tick).toBe(1);
    expect(msg.view.playerId).toBe(HUMAN_ID);
  });

  it('переключает туман локального матча', () => {
    const created = createLocalEngine(small, 42, 2, undefined, false);
    if ('errors' in created) throw new Error(created.errors.join('\n'));
    const msg = asView(created.tick());
    expect(created.state.fog).toBe(false);
    expect(msg.view.hexes.visible.every((value) => value === 1)).toBe(true);
    expect(msg.view.units).toHaveLength(created.state.units.length);
  });

  it('показывает снимок выбранного игрока и всю карту без изменения sim', () => {
    const created = createLocalEngine(small, 42, 2, undefined, true);
    if ('errors' in created) throw new Error(created.errors.join('\n'));
    created.setView(1, true);
    expect(asView(created.snapshot()).view.playerId).toBe(1);
    created.setView(null, false);
    expect(asView(created.snapshot()).view.playerId).toBe(HUMAN_ID);
    expect(asView(created.snapshot()).view.hexes.visible.every((value) => value === 1)).toBe(true);
    expect(created.state.fog).toBe(false);
    expect(created.state.tick).toBe(0);
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

  it('снимок после пакетного продвижения содержит события всех тиков', () => {
    const e = engine();
    e.queue({ t: 'foundCity', hex: 0 });
    e.advance();
    const msg = asView(e.tick());
    expect(msg.events.filter((event) => event.t === 'commandRejected')).toHaveLength(1);
    expect(asView(e.tick()).events).toEqual([]);
  });

  it('выбранный гекс: карточка города и проверки кнопок', () => {
    const e = engine();
    const capital = e.state.cities.find((c) => c.owner === HUMAN_ID);
    e.select(capital?.hex ?? -1);
    const msg = asView(e.tick());
    expect(msg.selection?.city?.isCapital).toBe(true);
    expect(msg.selection?.foundCity).toMatchObject({ ok: false, reason: 'isCity' });
  });

  it('набор отдаёт варианты с шагом 50 и пересчитывает время', () => {
    const e = engine();
    const capital = e.state.cities.find((c) => c.owner === HUMAN_ID);
    e.select(capital?.hex ?? -1);
    const selection = asView(e.tick()).selection;
    const infantry = selection?.recruit.find((option) => option.type === 'infantry');
    const first = infantry?.amounts[0];
    const second = infantry?.amounts[1];
    expect(first?.soldiers).toBe(50 * FP);
    expect(second?.soldiers).toBe(100 * FP);
    expect(second?.check.timeS).toBeGreaterThan(first?.check.timeS ?? 0);
  });

  it('набор без золота блокирует каждый вариант и возвращает причину', () => {
    const e = engine();
    const player = e.state.players[HUMAN_ID];
    if (!player) throw new Error('игрок не найден');
    player.gold = 0 as Fp;
    const capital = e.state.cities.find((c) => c.owner === HUMAN_ID);
    e.select(capital?.hex ?? -1);
    const selection = asView(e.tick()).selection;
    const infantry = selection?.recruit.find((option) => option.type === 'infantry');
    expect(infantry?.amounts[0]?.check).toMatchObject({ ok: false, reason: 'notEnoughGold' });
  });

  it('один снимок синхронно отражает переименование, набор и отказ повторного набора', () => {
    const e = engine();
    const capital = e.state.cities.find((c) => c.owner === HUMAN_ID);
    const army = e.state.armies.find((a) => a.owner === HUMAN_ID);
    if (!capital || !army) throw new Error('стартовые объекты не найдены');
    e.select(capital.hex);
    e.queue({ t: 'renameArmy', armyId: army.id, name: 'Флот резерва' });
    e.queue({ t: 'recruit', cityId: capital.id, type: 'infantry', soldiers: (50 * FP) as Fp });
    const started = asView(e.tick());
    expect(started.view.armies.find((a) => a.id === army.id)?.name).toBe('Флот резерва');
    expect(started.view.recruits).toHaveLength(1);
    expect(started.selection?.city?.id).toBe(capital.id);

    e.queue({ t: 'recruit', cityId: capital.id, type: 'infantry', soldiers: (50 * FP) as Fp });
    const rejected = asView(e.tick());
    expect(rejected.rejected).toEqual([{ command: 'recruit', reason: 'queueBusy' }]);
    expect(rejected.selection?.city?.id).toBe(capital.id);
    expect(rejected.view.recruits).toHaveLength(1);
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
