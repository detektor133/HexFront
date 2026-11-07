import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { withDepot } from '../../src/state/building.ts';
import { isPortOf } from '../../src/state/port.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Два острова A: западный с портом у воды, восточный с портом; на востоке — берег B.
const MAP = `
  A1 a  ~  ~  ~  a  a  b  B1
  a  a  ~  ~  ~  a  a  b  b
  a  a  ~  ~  ~  a  a  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function setup() {
  const s = scenario(MAP, { legend });
  const w = s.state.map.width;
  const west = 1 + w; // порт на западном острове у воды
  const east = 5 + w; // порт на восточном острове
  for (const h of [west, east]) {
    s.state.hexes.building[h] = withDepot(s.state.hexes.building[h] ?? 0, 1);
  }
  const unit = s.unit('A', 'infantry', 200, at(1, 1));
  return { s, west, east, unit, w };
}

describe('порты и морские переправы', () => {
  it('порт — склад у воды; город без склада и склад вдали от воды портами не являются', () => {
    const { s, west, east } = setup();
    expect(isPortOf(s.state, 0, west)).toBe(true);
    expect(isPortOf(s.state, 0, east)).toBe(true);
    expect(isPortOf(s.state, 0, 0)).toBe(false);
    const inland = 0 + 2 * s.state.map.width;
    s.state.hexes.building[inland] = withDepot(0, 1);
    expect(isPortOf(s.state, 0, inland)).toBe(false);
  });

  it('отряд из порта плывёт в другой свой порт бесплатно и причаливает', () => {
    const { s, east, unit } = setup();
    const gold = s.state.players[0]?.gold ?? 0;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [unit], to: east } }]);
    expect(s.unitById(unit)?.sea).toBe(true);
    expect(s.state.players[0]?.gold).toBe(gold);
    s.runSeconds(30);
    const u = s.unitById(unit);
    expect(u?.hex).toBe(east);
    expect(u?.sea).toBe(false);
    expect(u?.order).toBe('idle');
  });

  it('вторжение на чужой берег стоит золота и идёт боем', () => {
    const { s, unit, w } = setup();
    const gold = s.state.players[0]?.gold ?? 0;
    const shore = 5 + 2 * w;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    s.state.hexes.owner[shore] = 1;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [unit], to: shore } }]);
    expect(s.unitById(unit)?.sea).toBe(true);
    expect(s.state.players[0]?.gold ?? 0).toBeLessThan(gold);
    s.runSeconds(40);
    expect(s.unitById(unit)?.hex).toBe(shore);
    expect(s.state.hexes.owner[shore]).toBe(0);
  });

  it('вне порта, вне дальности и сверх вместимости переправа отклоняется; плывущему отряду приказов нет', () => {
    const { s, east, unit, w } = setup();
    const outside = s.unit('A', 'infantry', 100, at(0, 2));
    const gold = s.state.players[0]?.gold ?? 0;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [outside], to: east } }]);
    expect(s.unitById(outside)?.sea).toBe(false);
    const big = s.unit('A', 'infantry', 5000, at(1, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [big], to: east } }]);
    expect(s.unitById(big)?.sea).toBe(false);
    expect(s.state.players[0]?.gold).toBe(gold);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [unit], to: east } }]);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [unit], to: 1 + w } }]);
    expect(s.unitById(unit)?.sea).toBe(true);
    expect(s.unitById(unit)?.path.length).toBeGreaterThan(0);
  });
});
