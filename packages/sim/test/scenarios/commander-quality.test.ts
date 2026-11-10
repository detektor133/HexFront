import { describe, expect, it } from 'vitest';

import {
  PROCURE_BATCH,
  RECRUIT_MIN,
  RETURN_LOCK_TICKS,
  UNIT_SPLIT_SOLDIERS,
} from '../../src/balance.ts';
import { commanderLine } from '../../src/bots/commander-line.ts';
import { applyCommands } from '../../src/commands/apply.ts';
import { pickAxes } from '../../src/commands/axis.ts';
import { blocOf, borderPieces } from '../../src/commands/launch.ts';
import { hexFromId } from '../../src/math/hex.ts';
import { edgeHex } from '../../src/state/edges.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { recentlyLeft } from '../../src/state/return-lock.ts';
import { moveUnit } from '../../src/state/unit-index.ts';
import { lineRuns } from '../../src/systems/offensive.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const ROWS = 16;
const BORDER = Array.from({ length: ROWS }, (_, r) => {
  const cells = Array.from({ length: 12 }, (_, c): string => (c < 5 ? 'a' : 'b'));
  if (r === 0) cells[0] = 'A1';
  if (r === 1) cells[11] = 'B1';
  if (r === ROWS - 2) cells[10] = 'B2';
  return cells.join(' ');
}).join('\n');
const legend = {
  A1: city('A', 3, { capital: true }),
  a: own('A'),
  B1: city('B', 3, { capital: true }),
  B2: city('B', 3),
  b: own('B'),
};

function war() {
  const s = scenario(BORDER, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
  return s;
}

describe('линия наступления командира', () => {
  it('стена впереди своего участка одной цепочкой: концы фронта не огибаются', () => {
    const s = war();
    const piece = borderPieces(s.state, 0, 1)[0] ?? [];
    const window = piece.slice(Math.floor(piece.length / 2) - 4, Math.floor(piece.length / 2) + 5);
    const line = commanderLine(
      s.state.map,
      { hexes: s.state.hexes, cities: s.state.cities },
      window,
      blocOf(s.state, 0, 1),
      3,
    );
    expect(line.length).toBeGreaterThan(0);
    expect(lineRuns(s.state, line)).toHaveLength(1);
    const rows = (edges: readonly number[]) =>
      edges.map((e) => hexFromId(edgeHex(e), s.state.map.width).r);
    // Линия не выходит за ряды своего участка (раньше загибалась назад, огибая его концы).
    expect(Math.min(...rows(line))).toBeGreaterThanOrEqual(Math.min(...rows(window)) - 1);
    expect(Math.max(...rows(line))).toBeLessThanOrEqual(Math.max(...rows(window)) + 1);
  });
});

describe('ось удара рядом с войсками', () => {
  it('войска на юге сдвигают ось к югу: удар рядом с ними, а не на другом конце границы', () => {
    const s = war();
    const pieces = borderPieces(s.state, 0, 1);
    const enemy = blocOf(s.state, 0, 1);
    const south = at(4, ROWS - 3);
    const forces = [{ hex: south.col + south.row * s.state.map.width, soldiers: 3000 }];
    const axisRow = (strike: ReturnType<typeof pickAxes>): number => {
      const w = strike.windows[0] ?? [];
      const mid = w[Math.floor(w.length / 2)];
      return hexFromId(edgeHex(mid as number), s.state.map.width).r;
    };
    const blind = axisRow(pickAxes(s.state, 0, enemy, pieces, 600, [], 1));
    const local = axisRow(pickAxes(s.state, 0, enemy, pieces, 600, [], 1, forces));
    // Войска на юге тянут ось к югу сильнее, чем та же оценка без учёта, где они стоят.
    expect(local).toBeGreaterThan(blind);
  });
});

describe('закупка по городам', () => {
  it('недобор делится между городами сразу, а набор крупнее прежних 300', () => {
    const rich = `
      A1 a  a  a  b  b
      A2 a  a  a  b  b
      A3 a  a  a  b  b
      a  a  a  a  b  B1
    `;
    const s = scenario(rich, {
      legend: {
        A1: city('A', 3, { capital: true }),
        A2: city('A', 3),
        A3: city('A', 3),
        a: own('A'),
        B1: city('B', 1, { capital: true }),
        b: own('B'),
      },
    });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const player = s.state.players[0];
    if (player) player.gold = 100_000_000 as never;
    for (const c of s.state.cities.filter((x) => x.owner === 0)) {
      for (let h = 0; h < s.state.hexes.pop.length; h += 1) {
        if (s.state.hexes.owner[h] === 0) s.state.hexes.pop[h] = 50_000_000;
      }
      void c;
    }
    s.unit('A', 'infantry', 100, at(2, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 6000 } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    s.runSeconds(2);
    const orders = s.state.recruits.filter((r) => r.armyId === army?.id);
    // Все три города берутся параллельно, и набор больше прежнего предела в 300.
    expect(new Set(orders.map((r) => r.cityId)).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...orders.map((r) => r.soldiers))).toBeGreaterThan(300_000);
    expect(Math.max(...orders.map((r) => r.soldiers))).toBeLessThanOrEqual(PROCURE_BATCH);
  });
});

describe('запрет обратного хода', () => {
  it('автоматика не возвращает отряд в только что покинутый гекс, спустя время — можно', () => {
    const s = war();
    const id = s.unit('A', 'infantry', 300, at(2, 5));
    const unit = s.state.units.find((u) => u.id === id);
    if (!unit) throw new Error('нет отряда');
    const start = unit.hex;
    const to = at(3, 5).col + at(3, 5).row * s.state.map.width;
    moveUnit(s.state, unit, to);
    expect(recentlyLeft(s.state, unit, start)).toBe(true);
    expect(recentlyLeft(s.state, unit, to)).toBe(false);
    s.runTicks(RETURN_LOCK_TICKS);
    expect(recentlyLeft(s.state, unit, start)).toBe(false);
  });
});

describe('котёл в тылу не ось удара', () => {
  it('мелкий остаток врага внутри своей земли не выбирается осью, ось идёт по настоящему фронту', () => {
    const rows = Array.from({ length: 14 }, (_, r) =>
      Array.from({ length: 20 }, (_, c): string => {
        if (r === 0 && c === 0) return 'A1';
        if (r === 5 && c === 19) return 'B1';
        if (c === 3 && r === 9) return 'B2';
        if (c >= 3 && c <= 4 && r >= 8 && r <= 10) return 'b';
        return c < 10 ? 'a' : 'b';
      }).join(' '),
    ).join('\n');
    const s = scenario(rows, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const strike = pickAxes(
      s.state,
      0,
      blocOf(s.state, 0, 1),
      borderPieces(s.state, 0, 1),
      9000,
      [],
      3,
    );
    expect(strike.windows.length).toBeGreaterThan(0);
    const cols = strike.windows.flat().map((e) => edgeHex(e) % s.state.map.width);
    // Все оси — у настоящей границы (колонки 8+), ни одна не у котла в колонках 3–4.
    expect(Math.min(...cols)).toBeGreaterThanOrEqual(7);
  });
});

describe('крупный набор армии делится на нужные отряды', () => {
  it('пачка в 1000 приходит в армию отрядами по 300, а не одним слитком', () => {
    const s = war();
    const player = s.state.players[0];
    if (player) player.gold = 100_000_000 as never;
    for (let h = 0; h < s.state.hexes.pop.length; h += 1) {
      if (s.state.hexes.owner[h] === 0) s.state.hexes.pop[h] = 50_000_000;
    }
    s.unit('A', 'infantry', 100, at(2, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 5000 } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    s.runSeconds(25);
    const fresh = s.state.units.filter((u) => u.armyId === army?.id && u.soldiers !== 100_000);
    expect(fresh.length).toBeGreaterThan(3);
    expect(Math.max(...fresh.map((u) => u.soldiers))).toBeLessThanOrEqual(
      UNIT_SPLIT_SOLDIERS + RECRUIT_MIN,
    );
  });
});
