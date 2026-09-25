import { describe, expect, it } from 'vitest';

import type { UnitType } from '../../src/balance.ts';
import { FP } from '../../src/math/int.ts';
import { forecastBattle } from '../../src/queries/forecast.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { createRng, nextInt, nextRange } from '../../src/rng.ts';
import { at, attack, city, own, road, scenario, type At } from '../scenario/dsl.ts';

const legend = {
  A5: city('A', 5, { capital: true }),
  r: road('A'),
  B5: city('B', 5, { capital: true }),
  q: { kind: 'own', player: 'B', terrain: 'plains', road: true } as const,
  p: own('B'),
  f: own('B', 'forest'),
  h: own('B', 'hills'),
};

const hexOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

const FIELD = `
  ~  ~  ~  ~  ~  ~
  A5 r  r  p  q  B5
  ~  ~  ~  ~  ~  ~
`;

describe('прогноз боя', () => {
  it('сильный атакующий — «победа», слабый — «поражение», равные — «упорный бой»', () => {
    const run = (att: number, def: number): string => {
      const s = scenario(FIELD, { legend });
      const a = s.unit('A', 'infantry', att, at(2, 1));
      s.unit('B', 'infantry', def, at(3, 1));
      const f = forecastBattle(s.state.map, playerView(s.state, 0), [a], hexOf(s, at(3, 1)));
      return f.outcome;
    };
    expect(run(900, 200)).toBe('victory');
    expect(run(100, 900)).toBe('defeat');
    // Атака 1,0 против обороны 1,2: паритет при 1,2 × численности защитника.
    expect(run(600, 500)).toBe('stalemate');
  });

  it('время и потери: время = min(tDef, tAtt), потери = скорость × время / солдаты', () => {
    const s = scenario(FIELD, { legend });
    const a = s.unit('A', 'infantry', 600, at(2, 1));
    s.unit('B', 'infantry', 200, at(3, 1));
    const f = forecastBattle(s.state.map, playerView(s.state, 0), [a], hexOf(s, at(3, 1)));
    // A = 600, D = 240: org защитника −15/с (6 × 2,5), tDef = 100 / 15 ≈ 6,67 с.
    expect(f.outcome).toBe('victory');
    expect(f.timeS).toBe(6666);
    // Потери защитника: 600 × 0,01 × 6,67 / 200 ≈ 20 %; атакующего: 240 × 0,01 × 6,67 / 600 ≈ 2,7 %.
    expect(f.defenderLoss).toBeGreaterThan(195);
    expect(f.defenderLoss).toBeLessThan(205);
    expect(f.attackerLoss).toBeGreaterThan(25);
    expect(f.attackerLoss).toBeLessThan(28);
  });

  it('снабжение чужих отрядов неизвестно и считается 100 %', () => {
    const s = scenario(FIELD, { legend });
    const a = s.unit('A', 'infantry', 600, at(2, 1));
    const d = s.unit('B', 'infantry', 200, at(3, 1));
    const view = playerView(s.state, 0);
    expect(view.units.find((u) => u.id === d)?.supplyLevel).toBeNull();
    const f = forecastBattle(s.state.map, view, [a], hexOf(s, at(3, 1)));
    expect(f.defense).toBe(240 * FP);
  });

  it('пустой гекс или одинокая артиллерия — «победа» сразу', () => {
    const s = scenario(FIELD, { legend });
    const a = s.unit('A', 'infantry', 100, at(2, 1));
    const empty = forecastBattle(s.state.map, playerView(s.state, 0), [a], hexOf(s, at(3, 1)));
    expect(empty.outcome).toBe('victory');
    expect(empty.timeS).toBe(0);
    s.unit('B', 'artillery', 500, at(3, 1));
    const arty = forecastBattle(s.state.map, playerView(s.state, 0), [a], hexOf(s, at(3, 1)));
    expect(arty.outcome).toBe('victory');
  });
});

// Приёмка 03/T8: на 50 сгенерированных сценариях решительный прогноз («победа»/«поражение»)
// совпадает с фактическим исходом не реже 90 % при полной видимости.
describe('приёмка: прогноз против фактического боя', () => {
  const TYPES: readonly UnitType[] = ['infantry', 'infantry', 'armor'];
  const TERRAIN = ['p', 'f', 'h'];

  function generated(seed: number): { forecast: string; actual: string } {
    const rng = createRng(seed);
    const cell = TERRAIN[nextInt(rng, TERRAIN.length)] ?? 'p';
    const s = scenario(
      `
      ~  ~  r  ~  ~  ~
      A5 r  r  ${cell}  q  B5
      ~  ~  ~  r  ~  ~
    `,
      { legend },
    );
    const target = at(3, 1);
    // Атакующие — с соседних гексов (2,1) и, иногда, (2,0) и (3,2): до трёх направлений.
    const spots = [at(2, 1), at(2, 0), at(3, 2)].slice(0, 1 + nextInt(rng, 3));
    const attackers = spots.map((w) =>
      s.unit('A', TYPES[nextInt(rng, TYPES.length)] ?? 'infantry', 50 * nextRange(rng, 2, 10), w),
    );
    for (const id of attackers) s.setOrg(id, nextRange(rng, 50, 100));
    const defenders = 1 + nextInt(rng, 2);
    for (let i = 0; i < defenders; i += 1) {
      const d = s.unit(
        'B',
        TYPES[nextInt(rng, TYPES.length)] ?? 'infantry',
        50 * nextRange(rng, 2, 8),
        target,
      );
      s.setOrg(d, nextRange(rng, 50, 100));
    }
    if (nextInt(rng, 4) === 0) s.setBuilding(target, 'fort');
    // Снабжение пересчитано до прогноза: все на дорогах у столиц 5-го уровня.
    s.runTicks(10);
    const f = forecastBattle(s.state.map, playerView(s.state, 0), attackers, hexOf(s, target));
    s.cmd(
      'A',
      attack(
        attackers.filter((id) => s.unitById(id)),
        target,
      ),
    );
    for (let t = 0; t < 1800; t += 1) {
      s.runTicks(1);
      if (s.owner(target) === 'A') return { forecast: f.outcome, actual: 'victory' };
      if (attackers.every((id) => s.unitById(id)?.order !== 'attack')) {
        return { forecast: f.outcome, actual: 'defeat' };
      }
    }
    return { forecast: f.outcome, actual: 'stalemate' };
  }

  it('≥ 90 % совпадений среди решительных прогнозов', () => {
    const results = Array.from({ length: 50 }, (_, i) => generated(1000 + i));
    const decisive = results.filter((r) => r.forecast !== 'stalemate');
    const hits = decisive.filter((r) => r.forecast === r.actual).length;
    expect(decisive.length).toBeGreaterThanOrEqual(30);
    expect(hits / decisive.length).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
