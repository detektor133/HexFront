// Инициатива бота на войне (gdd/09-bots.md, «Война»): армия бота сама начинает наступление на
// врага, с которым война, — не ждёт ▶ от экономического мозга, — держится, пока слабее, и не стоит,
// когда линия выполнена или застряла.
import { describe, expect, it } from 'vitest';

import { BOT_PROFILES } from '../../src/balance.ts';
import { armyCard, frontForces, stance } from '../../src/bots/commander-war.ts';
import { commanderCommands } from '../../src/bots/run.ts';
import { FP } from '../../src/math/int.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { step } from '../../src/step.ts';
import { assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

// A и B граничат по столбцам 2 и 3.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;

type S = ReturnType<typeof scenario>;

// Армия A с auto из n отрядов по soldiers; фронт ставит commander сам.
function armyOf(s: S, n: number, soldiers: number): number {
  const ids = Array.from({ length: n }, () => s.unit('A', 'infantry', soldiers, at(2, 2)));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, army), 'auto');
  s.runTicks(1);
  return army;
}

// Прогоняет тики с командами commander бота A; возвращает типы команд за прогон.
function runBot(s: S, ticks: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const commands = commanderCommands(s.state, [0], ['medium', 'medium']);
    for (const c of commands) seen.push(c.cmd.t);
    step(s.state, commands);
  }
  return seen;
}

describe('commander-war: позиция', () => {
  it('нет врага у фронта — бить; слабее порога — держаться; идущее терпит больше', () => {
    const p = BOT_PROFILES.normal;
    expect(stance({ mine: 500, theirs: 0 }, false, p)).toBe('attack');
    expect(stance({ mine: 0, theirs: 0 }, false, p)).toBe('hold');
    // Порог начала — attackRatio, идущего — holdRatio (меньше).
    const between = Math.floor((p.attackRatio + p.holdRatio) / 2);
    expect(stance({ mine: between, theirs: 1000 }, false, p)).toBe('hold');
    expect(stance({ mine: between, theirs: 1000 }, true, p)).toBe('attack');
  });

  it('сложный бот решается раньше лёгкого', () => {
    const ratio = 1000;
    const forces = { mine: ratio * 1.1, theirs: ratio };
    expect(stance(forces, false, BOT_PROFILES.medium)).toBe('attack');
    expect(stance(forces, false, BOT_PROFILES.easy)).toBe('hold');
  });
});

describe('commander-war: бот наступает сам', () => {
  it('сильная армия бота начинает наступление без ▶ экономического мозга', () => {
    const s = scenario(FIELD, { legend });
    const army = armyOf(s, 6, 300);
    s.setTick(0);
    const seen = runBot(s, 80);
    expect(seen).toContain('startOffensive');
    const plan = s.state.plans.find((q) => q.armyId === army);
    expect(plan?.kind === 'front' && plan.offensive?.active).toBe(true);
  });

  it('слабая армия против сильного врага держится и не наступает', () => {
    const s = scenario(FIELD, { legend });
    armyOf(s, 1, 30);
    for (let i = 0; i < 6; i += 1) s.unit('B', 'infantry', 400, at(3, 2));
    s.setTick(0);
    expect(runBot(s, 80)).not.toContain('startOffensive');
  });

  it('силы у фронта считаются по видимому врагу и гарнизонам рядом', () => {
    const s = scenario(FIELD, { legend });
    armyOf(s, 2, 100);
    s.unit('B', 'infantry', 200, at(3, 1));
    s.setTick(0);
    const view = playerView(s.state, 0);
    const plan = view.plans.find((q) => q.kind === 'front');
    // План фронта ещё не поставлен: силы считаем по любому участку границы.
    const edges = plan?.kind === 'front' ? plan.edges : [];
    const own = view.units.filter((u) => u.owner === 0);
    const forces = frontForces(view, s.state.map.width, own, edges, {
      map: s.state.map,
      hexes: view.hexes,
    });
    expect(forces.mine).toBeGreaterThan(0);
  });
});

describe('commander-war: карточка армии бота', () => {
  const view = (): { view: ReturnType<typeof playerView>; army: number } => {
    const s = scenario(FIELD, { legend });
    const army = armyOf(s, 3, 200);
    return { view: playerView(s.state, 0), army };
  };

  it('впервые задаёт заказ не меньше нынешней численности, с долей танков и артиллерии по профилю', () => {
    const { view: v, army } = view();
    const forces = { mine: 600 * FP, theirs: 0 };
    const [cmd] = armyCard(v, army, forces, BOT_PROFILES.medium);
    expect(cmd?.t).toBe('setArmyLimit');
    if (cmd?.t !== 'setArmyLimit') return;
    expect(cmd.soldiers).toBeGreaterThanOrEqual(600);
    expect(cmd.mix?.artillery).toBeGreaterThan(0);
    // Лёгкий бот заказывает только пехоту.
    const [easy] = armyCard(v, army, forces, BOT_PROFILES.easy);
    expect(easy?.t === 'setArmyLimit' && easy.mix).toBeFalsy();
  });

  it('растёт вслед за видимым врагом, но не выше предела, и не падает ниже нынешнего заказа', () => {
    const { view: v, army } = view();
    const cap = armyCard(v, army, { mine: 600 * FP, theirs: 10_000_000 * FP }, BOT_PROFILES.normal);
    const small = armyCard(v, army, { mine: 600 * FP, theirs: 0 }, BOT_PROFILES.normal);
    const top = cap[0]?.t === 'setArmyLimit' ? cap[0].soldiers : 0;
    const base = small[0]?.t === 'setArmyLimit' ? small[0].soldiers : 0;
    expect(top).toBeGreaterThanOrEqual(base);
    expect(top).toBeLessThan(10_000_000);
  });
});
