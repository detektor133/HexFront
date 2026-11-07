import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { withDepot } from '../../src/state/building.ts';
import { isPortHex, isPortOf } from '../../src/state/port.ts';
import { assignFront, assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

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
    expect(s.state.players[0]?.gold).toBe(gold);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [unit], to: east } }]);
    // Порт уже держит в море отряд: ещё одному большому не хватит вместимости (он ждёт очереди).
    const big = s.unit('A', 'infantry', 5900, at(1, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [big], to: east } }]);
    expect(s.unitById(big)?.sea).toBe(false);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [unit], to: 1 + w } }]);
    expect(s.unitById(unit)?.sea).toBe(true);
    expect(s.unitById(unit)?.path.length).toBeGreaterThan(0);
  });

  it('обычный приказ «идти» на другой берег прокладывает путь через порты: суша, море, суша', () => {
    const { s, w } = setup();
    const walker = s.unit('A', 'infantry', 200, at(0, 2));
    const target = 6 + 2 * w;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [walker], to: target } }]);
    const path = s.unitById(walker)?.path ?? [];
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((h) => s.state.map.terrain[h] === 0)).toBe(true);
    s.runSeconds(90);
    const u = s.unitById(walker);
    expect(u?.hex).toBe(target);
    expect(u?.sea).toBe(false);
  });

  it('без двух своих портов или если суша есть, море в путь не попадает', () => {
    const { s, w, west } = setup();
    // Склад на востоке снят: порт один, на другой берег пути нет.
    s.state.hexes.building[5 + w] = 0;
    const walker = s.unit('A', 'infantry', 200, at(0, 2));
    const before = s.unitById(walker)?.path.length ?? 0;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [walker], to: 6 + 2 * w } }]);
    expect(s.unitById(walker)?.path.length ?? 0).toBe(before);
    // Внутри острова путь сухопутный.
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [walker], to: west } }]);
    const path = s.unitById(walker)?.path ?? [];
    expect(path.every((h) => s.state.map.terrain[h] !== 0)).toBe(true);
  });

  it('фронт на другом берегу: распределение само отправляет отряды через порты', () => {
    const { s, w } = setup();
    const ids = [s.unit('A', 'infantry', 200, at(0, 2)), s.unit('A', 'infantry', 200, at(1, 2))];
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, army));
    s.cmd('A', assignFront(army, 'B', null));
    s.runSeconds(150);
    const east = ids.filter((id) => (s.unitById(id)?.hex ?? 0) % w >= 5);
    expect(east.length).toBeGreaterThan(0);
  });

  it('город у воды — порт и без склада, ничей тоже; вдали от воды — нет', () => {
    const MAP2 = `
      A1 a  ~  ~  N1 a  a  b  B1
      a  a  ~  ~  a  a  a  b  b
    `;
    const s = scenario(MAP2, { legend: { ...legend, N1: city(null, 1) } });
    const neutral = s.cityAt(at(4, 0));
    expect(neutral).toBeDefined();
    expect(isPortHex(s.state, neutral?.hex ?? 0)).toBe(true);
    // Столица A1 стоит у воды? (0,0) и (1,0): вода в колонке 2, значит нет.
    expect(isPortHex(s.state, 0)).toBe(false);
  });

  it('вместимость порта — очередь: лишние отряды ждут, пока море освободится', () => {
    const { s, west, east, unit, w } = setup();
    s.state.hexes.building[west] = withDepot(0, 1);
    const second = s.unit('A', 'infantry', 5200, at(1, 1));
    const first = s.unitById(unit);
    if (first) first.soldiers = 5400 as typeof first.soldiers;
    const a = s.unitById(unit);
    const b = s.unitById(second);
    expect(a && b).toBeTruthy();
    for (const id of [unit, second]) {
      applyCommands(s.state, [{ playerId: 0, cmd: { t: 'move', unitIds: [id], to: east } }]);
    }
    s.runTicks(5);
    const afloat = [unit, second].filter((id) => s.unitById(id)?.sea).length;
    expect(afloat).toBe(1);
    s.runSeconds(120);
    // Причалив, отряды одного типа в одном гексе сливаются: на востоке нет плывущих, а солдаты целы.
    const landed = s.state.units.filter((u) => u.hex === east);
    expect(landed.length).toBeGreaterThan(0);
    expect(s.state.units.some((u) => u.sea)).toBe(false);
    expect(w).toBeGreaterThan(0);
  });

  it('отряд в море, у которого пропал порт назначения, возвращается в порт отправления', () => {
    const { s, west, east, unit } = setup();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'sail', unitIds: [unit], to: east } }]);
    s.runTicks(25);
    expect(s.unitById(unit)?.sea).toBe(true);
    // Приказ пропал посреди моря: отряд не остаётся на воде, а возвращается в порт отправления.
    const swimmer = s.unitById(unit);
    if (swimmer) {
      swimmer.path = [];
      swimmer.order = 'idle';
    }
    s.runSeconds(60);
    const u = s.unitById(unit);
    expect(u?.sea).toBe(false);
    expect(u?.hex).toBe(west);
  });

  it('вторжение: армия снимается со старого приказа, идёт в порт и высаживается на чужой берег', () => {
    const { s, west, unit, w } = setup();
    const walker = s.unit('A', 'infantry', 200, at(0, 2));
    const shore = 5 + 2 * w;
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits([unit, walker], army));
    s.runTicks(2);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    s.state.hexes.owner[shore] = 1;
    const gold = s.state.players[0]?.gold ?? 0;
    // Без войны вторжение на чужой берег отклоняется, с войной — принято.
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'invade', armyId: army, from: west, to: shore } },
    ]);
    expect(s.state.players[0]?.gold ?? 0).toBeLessThan(gold);
    s.runSeconds(120);
    const here = [unit, walker].map((id) => s.unitById(id)?.hex);
    expect(here.every((h) => h === shore || h === undefined)).toBe(true);
    expect(s.state.hexes.owner[shore]).toBe(0);
  });
});
