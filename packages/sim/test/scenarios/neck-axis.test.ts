import { describe, expect, it } from 'vitest';

import { commanderLine, isNeckHex } from '../../src/bots/commander-line.ts';
import { pickAxes } from '../../src/commands/axis.ts';
import { blocOf, borderPieces } from '../../src/commands/launch.ts';
import { distance, hexFromId } from '../../src/math/hex.ts';
import { edgeHex, edgeOther } from '../../src/state/edges.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

// Котёл врага 5×4 в нашей земле, от него коридор шириной в гекс к основной земле врага справа.
function mapText(): string {
  const rows: string[] = [];
  for (let r = 0; r < 24; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < 40; c += 1) {
      let cell = 'a';
      if (r === 0 && c === 0) cell = 'A1';
      if (c >= 30) cell = 'b';
      if (c >= 8 && c <= 12 && r >= 9 && r <= 12) cell = 'b';
      if (r === 10 && c >= 13 && c < 30) cell = 'b';
      if (c === 10 && r === 10) cell = 'B2';
      if (c === 35 && r === 12) cell = 'B1';
      cells.push(cell);
    }
    rows.push(cells.join(' '));
  }
  return rows.join('\n');
}
const legend = {
  A1: city('A', 3, { capital: true }),
  B1: city('B', 3, { capital: true }),
  B2: city('B', 2),
  a: own('A'),
  b: own('B'),
};

describe('перешеек врага: ни оси, ни линии', () => {
  it('ось не ложится на коридор в гекс, а линия котла не тянется по нему к основной земле', () => {
    const s = scenario(mapText(), { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const { width } = s.state.map;
    const idOf = (col: number, row: number): number => col + row * width;
    const enemy = blocOf(s.state, 0, 1);
    const ground = { map: s.state.map, hexes: s.state.hexes };
    // Предпосылка: коридор — перешеек, котёл — нет.
    expect(isNeckHex(ground, enemy, idOf(20, 10))).toBe(true);
    expect(isNeckHex(ground, enemy, idOf(10, 11))).toBe(false);

    const strike = pickAxes(s.state, 0, enemy, borderPieces(s.state, 0, 1), 9000, [], undefined, [
      { hex: idOf(10, 5), soldiers: 9000 },
    ]);
    expect(strike.windows.length).toBeGreaterThan(0);
    const cauldron = hexFromId(idOf(10, 10), width);
    for (const win of strike.windows) {
      const mid = win[Math.floor(win.length / 2)] as number;
      expect(isNeckHex(ground, enemy, edgeOther(s.state, mid))).toBe(false);
      const near = distance(hexFromId(edgeHex(mid), width), cauldron) <= 6;
      if (!near) continue;
      const line = commanderLine(
        s.state.map,
        { hexes: s.state.hexes, cities: s.state.cities },
        win,
        enemy,
        strike.depth,
      );
      for (const e of line) {
        expect(distance(hexFromId(edgeHex(e), width), cauldron)).toBeLessThanOrEqual(8);
      }
    }
  });
});
