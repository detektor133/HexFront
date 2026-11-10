import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  a  a  a  A2 a  a  b  b  B1
  a  a  a  a  a  a  a  a  a  a  b  b  b
  a  a  a  a  a  a  a  a  a  a  b  b  b
  a  a  a  a  a  a  a  a  a  a  b  b  b
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  A2: city('A', 3),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const total = (s: ReturnType<typeof scenario>, armyId: number): number =>
  s.state.units.filter((u) => u.armyId === armyId).reduce((n, u) => n + u.soldiers, 0) +
  s.state.recruits.filter((r) => r.armyId === armyId).reduce((n, r) => n + r.soldiers, 0);

describe('закупка не перебирает лимит', () => {
  it('техники больше состава: заказ добирает только разницу до лимита, а не недобор каждого типа', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const player = s.state.players[0];
    if (player) player.gold = 1_000_000_000 as never;
    s.state.hexes.pop.fill(5_000_000 as never);
    const ids = [
      ...Array.from({ length: 17 }, (_, i) => s.unit('A', 'infantry', 300, at(1 + (i % 8), i % 4))),
      ...Array.from({ length: 17 }, (_, i) => s.unit('A', 'armor', 300, at(1 + (i % 8), i % 4))),
    ];
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Строй' } }]);
    const armyId = s.state.armies.find((a) => a.owner === 0 && a.name === 'Строй')?.id ?? -1;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'assignUnits', unitIds: ids, armyId } }]);
    // Состав: танков 2000, артиллерии 1000 — а танков в армии уже 5100.
    applyCommands(s.state, [
      {
        playerId: 0,
        cmd: { t: 'setArmyLimit', armyId, soldiers: 16_000, mix: { armor: 2000, artillery: 1000 } },
      },
    ]);
    const start = total(s, armyId);
    let peak = 0;
    for (let i = 0; i < 60; i += 1) {
      s.runSeconds(1);
      peak = Math.max(peak, total(s, armyId));
    }
    // Заказано не больше недостающего до лимита (с запасом на шаг набора).
    expect(peak).toBeLessThanOrEqual(16_000 * 1000 + 1000);
    expect(total(s, armyId)).toBeGreaterThan(start);
  });
});
