import { describe, expect, it } from 'vitest';

import {
  BOT_ARMY_RATIO,
  BOT_EASY_TAX,
  BOT_EASY_THINK_TICKS,
  BOT_GOLD_RESERVE,
  BOT_TAX_PEACE,
  BOT_TAX_WAR,
  BOT_THINK_TICKS,
  RECRUIT_MIN,
  RECRUIT_STEP,
  TAX_MAX,
} from '../../src/balance.ts';
import { economyDecide } from '../../src/bots/economy.ts';
import { botCommands } from '../../src/bots/run.ts';
import { commanderCommands } from '../../src/bots/run.ts';
import type { Command } from '../../src/commands/types.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import { playerView } from '../../src/queries/player-view.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  own,
  raw,
  scenario,
  type At,
} from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

// A — большая своя земля без соседей; B далеко за ничьей землёй.
const PEACE = `
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  A1 a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  .
  a  a  a  a  a  a  a  a  a  .  .  B1
`;

// A и B граничат по столбцам 2 и 3.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;

type S = ReturnType<typeof scenario>;

const decide = (s: S): Command[] => economyDecide(s.state.map, playerView(s.state, 0));
const spending = (cmds: readonly Command[]): Command[] =>
  cmds.filter((c) => ['foundCity', 'improve', 'recruit', 'rebuildSupply'].includes(c.t));
const rich = (s: S): void => {
  s.player('A').gold = (5000 * FP) as Fp;
};

// Команду бота игрок A отдаёт как обычную; sim принимает её без отказа.
function accepted(s: S, cmd: Command): boolean {
  s.cmd('A', raw(cmd));
  s.runTicks(1);
  return s.rejections().length === 0;
}

describe('экономический мозг бота: налог и настройки (04/T23)', () => {
  it('мир — налог мирного времени; автопополнение включается', () => {
    const s = scenario(PEACE, { legend });
    const cmds = decide(s);
    expect(cmds).toContainEqual({ t: 'setTax', rate: BOT_TAX_PEACE });
    expect(cmds).toContainEqual({ t: 'setAutoReinforce', on: true });
  });

  it('враг у границы — налог военного времени', () => {
    const s = scenario(FIELD, { legend });
    expect(decide(s)).toContainEqual({ t: 'setTax', rate: BOT_TAX_WAR });
  });

  it('банкротство близко (золото ниже резерва, баланс в минусе) — налог максимум', () => {
    const s = scenario(FIELD, { legend });
    for (let i = 0; i < 3; i += 1) s.unit('A', 'armor', 1000, at(0, i));
    s.player('A').gold = 0 as Fp;
    expect(decide(s)).toContainEqual({ t: 'setTax', rate: TAX_MAX });
  });

  it('налог уже нужный — команды налога нет', () => {
    const s = scenario(PEACE, { legend });
    s.player('A').taxTarget = BOT_TAX_PEACE;
    expect(decide(s).filter((c) => c.t === 'setTax')).toEqual([]);
  });
});

describe('экономический мозг бота: траты (04/T23)', () => {
  it('основать город: валидный гекс и золото с резервом — город, sim принимает', () => {
    const s = scenario(PEACE, { legend });
    rich(s);
    s.setPop(at(7, 3), 100);
    const found = decide(s).find((c) => c.t === 'foundCity');
    expect(found).toEqual({ t: 'foundCity', hex: 7 + 3 * 12 });
    expect(accepted(s, found as Command)).toBe(true);
  });

  it('золота только на цену без резерва — город не основывается', () => {
    const s = scenario(PEACE, { legend });
    s.player('A').gold = ((120 + BOT_GOLD_RESERVE / FP - 1) * FP) as Fp;
    s.setPop(at(7, 3), 100);
    expect(decide(s).filter((c) => c.t === 'foundCity')).toEqual([]);
  });

  it('благоустройство: гекс у города с населением ≥ 80 % лимита, sim принимает', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(1, 2), 90);
    const cmds = decide(s);
    expect(cmds).toContainEqual({ t: 'improve', hex: 1 + 2 * 8 });
    expect(accepted(s, { t: 'improve', hex: 1 + 2 * 8 })).toBe(true);
  });

  it('благоустраиваются только гексы в кольцах своих городов (радиус 2)', () => {
    const s = scenario(PEACE, { legend });
    // На город не хватает (120 + резерв), на благоустройство — хватает.
    s.player('A').gold = (100 * FP) as Fp;
    s.setPop(at(7, 3), 100);
    s.setPop(at(3, 4), 90);
    expect(decide(s).find((c) => c.t === 'improve')).toEqual({ t: 'improve', hex: 3 + 4 * 12 });
  });

  it('набор: сила у границы меньше 0,8 × силы сильнейшего соседа — пехота в городе', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(0, 2), 300);
    s.unit('A', 'infantry', 100, at(2, 2));
    for (let r = 1; r < 4; r += 1) s.unit('B', 'infantry', 500, at(3, r));
    const view = playerView(s.state, 0);
    const max = view.cities.find((c) => c.owner === 0)?.recruitMax ?? 0;
    expect(max).toBeGreaterThanOrEqual(RECRUIT_MIN);
    const rec = economyDecide(s.state.map, view).find((c) => c.t === 'recruit');
    expect(BOT_ARMY_RATIO).toBe(0.8 * FP);
    expect(rec).toMatchObject({ t: 'recruit', type: 'infantry' });
    const soldiers = rec?.t === 'recruit' ? rec.soldiers : 0;
    expect(soldiers).toBeGreaterThanOrEqual(RECRUIT_MIN);
    expect(soldiers).toBeLessThanOrEqual(max);
    expect(soldiers % RECRUIT_STEP).toBe(0);
    expect(accepted(s, rec as Command)).toBe(true);
  });

  it('содержание достигло половины дохода — новых солдат не набирает', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(0, 2), 300);
    s.unit('A', 'armor', 10_000, at(0, 0));
    for (let r = 1; r < 4; r += 1) s.unit('B', 'infantry', 500, at(3, r));
    expect(decide(s).filter((c) => c.t === 'recruit')).toEqual([]);
  });

  it('при занятой фронтами армии создаёт отдельную армию экспансии', () => {
    const s = scenario(PEACE, { legend });
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A')[0]?.id ?? -1;
    s.state.plans.push({ armyId: army, kind: 'line', hexes: [0] });
    expect(decide(s)).toContainEqual({ t: 'createArmy', name: '' });
  });

  it('глобальный лимит отрядов не блокирует набор при достаточном бюджете', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(0, 2), 300);
    for (let i = 0; i < 8; i += 1) s.unit('A', 'infantry', 10, at(i % 3, 4));
    for (let r = 1; r < 4; r += 1) s.unit('B', 'infantry', 500, at(3, r));
    expect(decide(s).find((c) => c.t === 'recruit')).toMatchObject({
      t: 'recruit',
      type: 'infantry',
    });
  });

  it('лишнее золото — улучшение города, sim принимает', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    const up = decide(s).find((c) => c.t === 'upgradeCity');
    expect(up).toEqual({ t: 'upgradeCity', cityId: s.cityAt(at(0, 2))?.id });
    expect(accepted(s, up as Command)).toBe(true);
  });

  it('врага не видно — набора нет', () => {
    const s = scenario(PEACE, { legend });
    rich(s);
    s.setPop(at(3, 3), 300);
    expect(decide(s).filter((c) => c.t === 'recruit')).toEqual([]);
  });

  it('малый отряд пополняется даже без видимого врага', () => {
    const s = scenario(PEACE, { legend });
    rich(s);
    s.setPop(at(3, 3), 300);
    s.unit('A', 'infantry', 5, at(3, 3));
    expect(decide(s).find((c) => c.t === 'recruit')).toMatchObject({
      t: 'recruit',
      type: 'infantry',
    });
  });

  it('изолированный город — перестройка снабжения', () => {
    const s = scenario(
      `
      a  a  a  a  a  a  a  a  a
      a  A1 a  a  a  a  A2 a  a
      a  a  a  a  a  a  a  a  a
      .  .  .  .  .  .  .  .  B1
    `,
      { legend },
    );
    rich(s);
    s.runTicks(20);
    const a2 = s.cityAt(at(6, 1))?.id;
    const view = playerView(s.state, 0);
    expect(view.cities.find((c) => c.id === a2)?.isolated).toBe(true);
    expect(view.cities.find((c) => c.id === a2)?.canRebuild).toBe(true);
    expect(economyDecide(s.state.map, view)).toContainEqual({ t: 'rebuildSupply', cityId: a2 });
  });

  it('изолированный город без пути к столице — дорогу не просит', () => {
    const s = scenario(
      `
      a  a  a  ~  a  a  a
      a  A1 a  ~  a  A2 a
      a  a  a  ~  a  a  a
      .  .  .  ~  .  .  B1
    `,
      { legend },
    );
    rich(s);
    s.runTicks(20);
    const view = playerView(s.state, 0);
    const a2 = view.cities.find((c) => c.hex === 5 + 1 * 7);
    expect(a2?.isolated).toBe(true);
    expect(a2?.canRebuild).toBe(false);
    expect(decide(s).filter((c) => c.t === 'rebuildSupply')).toEqual([]);
  });

  it('за одно решение — не больше одной траты', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(1, 2), 90);
    s.setPop(at(0, 2), 300);
    for (let r = 1; r < 4; r += 1) s.unit('B', 'infantry', 500, at(3, r));
    expect(spending(decide(s))).toHaveLength(1);
  });
});

describe('экономический мозг бота: ▶ «Начать» (04/T23)', () => {
  function frontArmy(s: S, soldiers: number, where: At = at(2, 2)): number {
    const ids = Array.from({ length: 3 }, () => s.unit('A', 'infantry', soldiers, where));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, army), 'auto');
    s.cmd('A', assignFront(army, 'B', null), 'auto');
    s.runSeconds(20);
    return army;
  }

  it('у армии с «А» прогноз «победа» на участке — ▶', () => {
    const s = scenario(FIELD, { legend });
    const army = frontArmy(s, 300);
    s.unit('B', 'infantry', 20, at(3, 2));
    expect(decide(s)).toContainEqual({ t: 'startOffensive', armyId: army });
  });

  it('враг сильнее — ▶ не нажимается', () => {
    const s = scenario(FIELD, { legend });
    frontArmy(s, 50);
    for (let r = 0; r < 5; r += 1) s.unit('B', 'infantry', 900, at(3, r));
    expect(decide(s).filter((c) => c.t === 'startOffensive')).toEqual([]);
  });

  it('easy не нажимает ▶, а commander сохраняет обычные команды', () => {
    const s = scenario(FIELD, { legend });
    const army = frontArmy(s, 300);
    s.unit('B', 'infantry', 20, at(3, 2));
    s.setTick(210);

    expect(decide(s)).toContainEqual({ t: 'startOffensive', armyId: army });
    expect(botCommands(s.state, [0], ['easy'])).not.toContainEqual(
      expect.objectContaining({ cmd: { t: 'startOffensive', armyId: army } }),
    );
    expect(commanderCommands(s.state, [0], ['easy'])).toEqual(commanderCommands(s.state, [0]));
  });
});

describe('экономический мозг бота: когда решает и детерминизм (04/T23)', () => {
  it('раз в BOT_THINK_TICKS, тик бота — id mod BOT_THINK_TICKS; только боты', () => {
    const s = scenario(FIELD, { legend });
    for (let t = 200; t < 200 + BOT_THINK_TICKS; t += 1) {
      s.setTick(t);
      const by = new Set(botCommands(s.state, [1]).map((c) => c.playerId));
      expect([...by]).toEqual(t % BOT_THINK_TICKS === 1 ? [1] : []);
    }
  });

  it('одинаковый снимок — одинаковые команды', () => {
    const s = scenario(FIELD, { legend });
    rich(s);
    s.setPop(at(1, 2), 90);
    expect(economyDecide(s.state.map, playerView(s.state, 0))).toEqual(
      economyDecide(s.state.map, playerView(s.state, 0)),
    );
  });

  it('easy думает раз в BOT_EASY_THINK_TICKS и удерживает налог 20 %', () => {
    const s = scenario(FIELD, { legend });
    for (let t = 200; t < 200 + BOT_EASY_THINK_TICKS; t += 1) {
      s.setTick(t);
      const commands = botCommands(s.state, [1], [undefined, 'easy']);
      expect(new Set(commands.map((c) => c.playerId))).toEqual(
        t % BOT_EASY_THINK_TICKS === 1 ? new Set([1]) : new Set(),
      );
      if (commands.length > 0)
        expect(commands).toContainEqual({ playerId: 1, cmd: { t: 'setTax', rate: BOT_EASY_TAX } });
    }
  });
});
