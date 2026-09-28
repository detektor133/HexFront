import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Fp } from '@hexfront/sim';

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

  it('ошибка карты возвращается, а не бросается', () => {
    expect(createLocalEngine({ version: 2 }, 1, 2)).toMatchObject({ errors: expect.any(Array) });
  });
});
