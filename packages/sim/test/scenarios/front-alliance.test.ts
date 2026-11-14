import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { borderPieces } from '../../src/commands/scope.ts';
import { createDiplomacy, setRelation } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Игрок A в центре, три соседа по сторонам: B слева, C справа, D снизу.
const MAP = `
  b  b  a  a  a  c  c
  B1 b  a  A1 a  c  C1
  b  b  a  a  a  c  c
  d  d  d  d  d  d  d
  d  d  D1 d  d  d  d
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  B1: city('B', 1, { capital: true }),
  C1: city('C', 1, { capital: true }),
  D1: city('D', 1, { capital: true }),
  a: own('A'),
  b: own('B'),
  c: own('C'),
  d: own('D'),
};

function game() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (const row of [0, 1, 2]) s.unit('A', 'infantry', 300, at(2 + (row % 3), row));
  return s;
}

describe('фронты держатся за участки границы, а не за блок врагов', () => {
  it('враги слились в альянс — фронт каждой армии остаётся на границе только со своей целью', () => {
    const s = game();
    for (const id of [1, 2, 3]) {
      applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: id } }]);
    }
    const armies: number[] = [];
    for (const id of [1, 2, 3]) {
      applyCommands(s.state, [
        { playerId: 0, cmd: { t: 'holdBorder', target: id, soldiers: 100 } },
      ]);
    }
    for (const a of s.state.armies) if (a.owner === 0 && a.dir) armies.push(a.id);
    const before = armies.map((id) => s.state.plans.find((p) => p.armyId === id)?.kind);
    expect(before.every((k) => k === 'front')).toBe(true);

    // Враги заключают альянс между собой: фронты не должны разъехаться.
    for (const [x, y] of [
      [1, 2],
      [1, 3],
      [2, 3],
    ] as const) {
      setRelation(s.state, x, y, 'alliance');
    }
    s.runTicks(30);
    for (const id of [1, 2, 3]) {
      const army = s.state.armies.find((a) => a.owner === 0 && a.dir?.target === id);
      const plan = s.state.plans.find((p) => p.armyId === army?.id);
      expect(plan?.kind).toBe('front');
      const own = borderPieces(s.state, 0, id).flat();
      const edges = plan?.kind === 'front' ? plan.edges : [];
      expect(edges.length).toBeGreaterThan(0);
      expect([...edges].sort()).toEqual([...own].sort());
    }
  });

  it('приказ на члена альянса охватывает весь блок; усиление и раздел границы страны', () => {
    const s = game();
    for (const id of [1, 2, 3]) {
      applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: id } }]);
    }
    for (const [x, y] of [
      [1, 2],
      [1, 3],
      [2, 3],
    ] as const) {
      setRelation(s.state, x, y, 'alliance');
    }
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 100 } }]);
    const first = s.state.armies.find((a) => a.owner === 0 && a.dir);
    expect(first?.dir?.bloc).toBe(true);
    const whole = [...borderPieces(s.state, 0, 1, true).flat()].sort((a, b) => a - b);
    const planOf = (id: number | undefined) => {
      const plan = s.state.plans.find((p) => p.armyId === id);
      return plan?.kind === 'front' ? plan.edges : [];
    };
    expect([...planOf(first?.id)].sort((a, b) => a - b)).toEqual(whole);

    // Усиление: армия на блок уже держит границу — новая армия берёт только эту страну.
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'holdBorder', target: 2, soldiers: 100, armyId: -1 } },
    ]);
    const second = s.state.armies.find((a) => a.owner === 0 && a.dir && a.id !== first?.id);
    expect(second?.dir?.bloc).toBeUndefined();
    const country = [...borderPieces(s.state, 0, 2).flat()].sort((a, b) => a - b);
    expect([...planOf(second?.id)].sort((a, b) => a - b)).toEqual(country);
    expect([...planOf(first?.id)].sort((a, b) => a - b)).toEqual(whole);

    // Ещё одна армия на ту же страну: две армии страны делят её границу без наложения.
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'holdBorder', target: 2, soldiers: 100, armyId: -1 } },
    ]);
    s.runTicks(5);
    const mates = s.state.armies.filter((a) => a.owner === 0 && a.dir && !a.dir.bloc);
    expect(mates.length).toBe(2);
    const [a, b] = mates.map((x) => planOf(x.id));
    expect(a?.length).toBeGreaterThan(0);
    expect(b?.length).toBeGreaterThan(0);
    expect(a?.some((e) => b?.includes(e))).toBe(false);
    expect([...(a ?? []), ...(b ?? [])].sort((x, y) => x - y)).toEqual(country);

    // Снять с фронта одну армию: приказ по номеру армии, вторая остаётся.
    const gone = mates[0];
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'holdBorder', target: 2, soldiers: 0, armyId: gone?.id ?? -1 } },
    ]);
    expect(s.state.armies.find((x) => x.id === gone?.id)?.dir?.mode).toBe('idle');
    expect(s.state.armies.find((x) => x.id === mates[1]?.id)?.dir?.mode).toBe('hold');
  });

  it('член блока капитулировал — армия на весь блок остаётся на фронте с живыми', () => {
    const s = game();
    for (const id of [1, 2, 3]) {
      applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: id } }]);
    }
    for (const [x, y] of [
      [1, 2],
      [1, 3],
      [2, 3],
    ] as const) {
      setRelation(s.state, x, y, 'alliance');
    }
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 100 } }]);
    const army = s.state.armies.find((a) => a.owner === 0 && a.dir);
    expect(army?.dir?.target).toBe(1);
    const dead = s.state.players[1];
    if (dead) dead.status = 'eliminated';
    s.runSeconds(2);
    const after = s.state.armies.find((a) => a.id === army?.id);
    expect(after?.dir?.mode).toBe('hold');
    expect([2, 3]).toContain(after?.dir?.target);
    expect(after?.dir?.bloc).toBe(true);
    expect(s.state.plans.some((p) => p.armyId === army?.id)).toBe(true);
  });
});
