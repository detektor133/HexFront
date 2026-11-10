// Контролируемые сценарии командира (замер до/после правок): каждый сценарий — фиксированная карта
// и приказ игрока, без случайности и без ботов, поэтому разница между версиями кода — это разница
// в поведении, а не шум партии. Запуск: node --experimental-strip-types src/commander-scenarios.ts [метка]
import { commanderLine } from '../../../packages/sim/src/bots/commander-line.ts';
import { applyCommands } from '../../../packages/sim/src/commands/apply.ts';
import { pickAxes } from '../../../packages/sim/src/commands/axis.ts';
import { blocOf, borderPieces } from '../../../packages/sim/src/commands/launch.ts';
import { distance, hexFromId, neighbors } from '../../../packages/sim/src/math/hex.ts';
import { FP } from '../../../packages/sim/src/math/int.ts';
import { edgeHex } from '../../../packages/sim/src/state/edges.ts';
import { cityPopCap, hexPopCap } from '../../../packages/sim/src/state/pop-cap.ts';
import { createDiplomacy } from '../../../packages/sim/src/state/relations.ts';
import type { Unit } from '../../../packages/sim/src/state/types.ts';
import { lineRuns } from '../../../packages/sim/src/systems/offensive.ts';
import { assignFront, at, city, own, scenario } from '../../../packages/sim/test/scenario/dsl.ts';

void assignFront;
const LABEL = process.argv[2] ?? 'run';

/** Карта: A слева (до border колонок), B справа; ряды 0..rows-1; города по местам. */
interface Spec {
  readonly cols: number;
  readonly rows: number;
  /** Колонка границы для ряда. */
  readonly border: (row: number) => number;
  /** Особые клетки: [col,row] -> код легенды. */
  readonly marks?: ReadonlyMap<string, string>;
}

function mapText(spec: Spec): string {
  const rows: string[] = [];
  for (let r = 0; r < spec.rows; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < spec.cols; c += 1) {
      cells.push(spec.marks?.get(`${c},${r}`) ?? (c < spec.border(r) ? 'a' : 'b'));
    }
    rows.push(cells.join(' '));
  }
  return rows.join('\n');
}

const legend = {
  A1: city('A', 3, { capital: true }),
  A2: city('A', 3),
  A3: city('A', 3),
  A4: city('A', 3),
  A5: city('A', 3),
  B1: city('B', 3, { capital: true }),
  B2: city('B', 3),
  B3: city('B', 3),
  a: own('A'),
  b: own('B'),
};

function game(spec: Spec) {
  const s = scenario(mapText(spec), { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
  return s;
}

type S = ReturnType<typeof game>;
const idOf = (s: S, col: number, row: number): number => col + row * s.state.map.width;
const mine = (s: S, p = 0): Unit[] => s.state.units.filter((u) => u.owner === p);
const soldiers = (units: readonly Unit[]): number =>
  Math.round(units.reduce((x, u) => x + u.soldiers, 0) / FP);
const hexesOf = (s: S, p = 0): number => s.state.hexes.owner.filter((o) => o === p).length;
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Следит за возвратами «A→B→A быстрее 30 с», сменой мест и шагами. */
function watcher(s: S, owner: number) {
  const last = new Map<number, { hex: number; prev: number; prevTick: number; slot: number }>();
  const out = {
    back: 0,
    steps: 0,
    slotChanges: 0,
    unitTicks: 0,
    encircled: 0,
    wasEnc: new Set<number>(),
  };
  return {
    out,
    tick(): void {
      for (const u of s.state.units) {
        if (u.owner !== owner) continue;
        out.unitTicks += 1;
        const m = last.get(u.id);
        if (!m) {
          last.set(u.id, { hex: u.hex, prev: -1, prevTick: -1e9, slot: u.slot });
          continue;
        }
        if (u.hex !== m.hex) {
          out.steps += 1;
          if (m.prev === u.hex && s.state.tick - m.prevTick <= 300) out.back += 1;
          m.prev = m.hex;
          m.prevTick = s.state.tick;
          m.hex = u.hex;
        }
        if (u.slot >= 0 && m.slot >= 0 && u.slot !== m.slot) out.slotChanges += 1;
        m.slot = u.slot;
        if (u.encircled && !out.wasEnc.has(u.id)) {
          out.encircled += 1;
          out.wasEnc.add(u.id);
        }
        if (!u.encircled) out.wasEnc.delete(u.id);
      }
    },
  };
}

function run(s: S, ticks: number, w?: ReturnType<typeof watcher>): void {
  for (let i = 0; i < ticks; i += 1) {
    s.runTicks(1);
    w?.tick();
  }
}

const result: Record<string, unknown> = { label: LABEL };

// ---------------------------------------------------------------- С1. Тыл и ось удара (п.1, 5)
{
  const spec: Spec = {
    cols: 30,
    rows: 18,
    border: () => 12,
    marks: new Map([
      ['0,0', 'A1'],
      ['29,9', 'B1'],
      ['13,2', 'B2'],
      ['13,15', 'B3'],
    ]),
  };
  const s = game(spec);
  // 60 пехотинцев в тылу (колонки 0–5), 6 орудий; у врага 24 отряда у границы.
  let n = 0;
  for (let c = 0; c < 6 && n < 60; c += 1) {
    for (let r = 1; r < 17 && n < 60; r += 1) {
      s.unit('A', 'infantry', 300, at(c, r));
      n += 1;
    }
  }
  for (let r = 3; r < 15; r += 2) s.unit('A', 'artillery', 300, at(6, r));
  for (let r = 1; r < 17; r += 2) s.unit('B', 'infantry', 300, at(13, r));
  applyCommands(s.state, [
    { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 30000 } },
  ]);
  const army = s.state.armies.find((a) => a.owner === 0);
  const samples: Record<string, unknown> = {};
  const base = hexesOf(s);
  let elapsed = 0;
  for (const sec of [30, 60, 120, 180]) {
    run(s, (sec - elapsed) * 10);
    elapsed = sec;
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    const strike = plan?.kind === 'front' && plan.offensive?.active ? plan.offensive.hexes : [];
    const inf = mine(s).filter((u) => u.type === 'infantry' && u.armyId === army?.id);
    const { width } = s.state.map;
    const far = inf.filter((u) => {
      if (strike.length === 0) return false;
      const h = hexFromId(u.hex, width);
      return Math.min(...strike.map((x) => distance(h, hexFromId(x, width)))) > 10;
    });
    const idleFar = far.filter((u) => u.order === 'idle').length;
    const front = mine(s).filter((u) => u.type === 'infantry');
    const meanX =
      front.length === 0
        ? 0
        : front.reduce(
            (x, u) => x + (hexFromId(u.hex, width).q + hexFromId(u.hex, width).r / 2),
            0,
          ) / front.length;
    samples[`t${sec}`] = {
      hexesGained: hexesOf(s) - base,
      idleFarPct: inf.length === 0 ? 0 : r1((idleFar / inf.length) * 100),
      meanColumn: r1(meanX),
      units: mine(s).length,
    };
  }
  result.s1_rear = samples;
}

// ---------------------------------------------------------------- С2. Линии и котёл (п.2)
{
  // Рваные границы + анклав врага в тылу A с городом; сто вариантов по детерминированному генератору.
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  let lines = 0;
  let broken = 0;
  let edges = 0;
  let spreadSum = 0;
  let enclaveAxes = 0;
  let axes = 0;
  let overshoot = 0;
  for (let v = 0; v < 40; v += 1) {
    const jag = Array.from({ length: 20 }, () => 9 + rnd(4));
    const marks = new Map<string, string>([
      ['0,0', 'A1'],
      ['25,10', 'B1'],
      ['15,4', 'B2'],
      // анклав врага с городом глубоко в тылу A
      ['3,9', 'B3'],
      ['4,9', 'b'],
      ['3,10', 'b'],
      ['4,10', 'b'],
      ['3,8', 'b'],
      ['4,8', 'b'],
    ]);
    const spec: Spec = { cols: 26, rows: 20, border: (r) => jag[r] ?? 10, marks };
    const s = game(spec);
    const pieces = borderPieces(s.state, 0, 1);
    const enemy = blocOf(s.state, 0, 1);
    const front = idOf(s, 7, 10);
    const forces = [{ hex: front, soldiers: 6000 }];
    const strike = (pickAxes as (...a: unknown[]) => ReturnType<typeof pickAxes>)(
      s.state,
      0,
      enemy,
      pieces,
      9000,
      [],
      undefined,
      forces,
    );
    for (const w of strike.windows) {
      axes += 1;
      const mid = hexFromId(edgeHex(w[Math.floor(w.length / 2)] as number), s.state.map.width);
      if (distance(mid, hexFromId(idOf(s, 4, 9), s.state.map.width)) <= 2) enclaveAxes += 1;
      const line = commanderLine(
        s.state.map,
        { hexes: s.state.hexes, cities: s.state.cities },
        w,
        enemy,
        strike.depth,
      );
      if (line.length === 0) continue;
      lines += 1;
      edges += line.length;
      if (lineRuns(s.state, line).length > 1) broken += 1;
      const win = w.map((e) => hexFromId(edgeHex(e), s.state.map.width));
      let spread = 0;
      let out = 0;
      const rows = win.map((h) => h.r);
      for (const e of line) {
        const h = hexFromId(edgeHex(e), s.state.map.width);
        spread = Math.max(spread, Math.min(...win.map((x) => distance(x, h))));
        if (h.r < Math.min(...rows) - 1 || h.r > Math.max(...rows) + 1) out += 1;
      }
      spreadSum += spread;
      overshoot += out;
    }
  }
  result.s2_lines = {
    lines,
    axes,
    brokenPct: r1((broken / Math.max(1, lines)) * 100),
    avgEdges: r1(edges / Math.max(1, lines)),
    avgSpread: r1(spreadSum / Math.max(1, lines)),
    edgesPastWindowEnds: r1(overshoot / Math.max(1, lines)),
    axesInRearEnclavePct: r1((enclaveAxes / Math.max(1, axes)) * 100),
  };
}

// ---------------------------------------------------------------- С3. Наём (п.3)
{
  const marks = new Map<string, string>([
    ['0,0', 'A1'],
    ['4,6', 'A2'],
    ['2,12', 'A3'],
    ['8,3', 'A4'],
    ['9,14', 'A5'],
    ['26,8', 'B1'],
  ]);
  const s = game({ cols: 28, rows: 18, border: () => 12, marks });
  const player = s.state.players[0];
  if (player) player.gold = (1_000_000 * FP) as typeof player.gold;
  for (let h = 0; h < s.state.hexes.owner.length; h += 1) {
    if (s.state.hexes.owner[h] !== 0) continue;
    const c = s.state.cities.find((x) => x.hex === h);
    s.state.hexes.pop[h] = c ? cityPopCap(c.level) : hexPopCap(s.state, h);
  }
  s.unit('A', 'infantry', 300, at(8, 8));
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 12000 } }]);
  const army = s.state.armies.find((a) => a.owner === 0);
  const wanted = 12000;
  const samples: Record<string, unknown> = {};
  let reached90: number | null = null;
  let elapsed = 0;
  for (const sec of [10, 20, 40, 60, 90, 120]) {
    run(s, (sec - elapsed) * 10);
    elapsed = sec;
    const inArmy = s.state.units.filter((u) => u.armyId === army?.id);
    const queued = s.state.recruits.filter((r) => r.armyId === army?.id);
    const total = soldiers(inArmy) + Math.round(queued.reduce((x, r) => x + r.soldiers, 0) / FP);
    if (reached90 === null && total >= wanted * 0.9) reached90 = sec;
    samples[`t${sec}`] = {
      soldiersPlusQueue: total,
      soldiersReady: soldiers(inArmy),
      units: inArmy.length,
      citiesRecruiting: new Set(queued.map((r) => r.cityId)).size,
    };
  }
  result.s3_recruit = { wanted, reached90Sec: reached90, ...samples };
}

// ---------------------------------------------------------------- С4. Перебежки (п.4)
{
  const marks = new Map<string, string>([
    ['0,0', 'A1'],
    ['29,9', 'B1'],
    ['13,3', 'B2'],
  ]);
  const s = game({ cols: 30, rows: 20, border: (r) => 12 + (r % 3), marks });
  let n = 0;
  for (let c = 3; c < 11 && n < 90; c += 1) {
    for (let r = 1; r < 19 && n < 90; r += 1) {
      s.unit('A', 'infantry', 300, at(c, r));
      n += 1;
    }
  }
  for (let r = 2; r < 18; r += 3) s.unit('B', 'infantry', 300, at(14, r));
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 30000 } }]);
  run(s, 600); // разгон
  const w = watcher(s, 0);
  // Враг шевелится: раз в 5 с его отряд у границы смещается — веса угрозы меняются.
  for (let i = 0; i < 1200; i += 1) {
    if (i % 50 === 0) {
      const foes = s.state.units.filter((u) => u.owner === 1 && u.order === 'idle');
      const f = foes[(i / 50) % Math.max(1, foes.length)];
      if (f) {
        const h = hexFromId(f.hex, s.state.map.width);
        const to = idOf(
          s,
          Math.min(29, Math.max(13, h.q + (i % 100 === 0 ? 1 : -1))),
          Math.min(19, Math.max(0, h.r)),
        );
        applyCommands(s.state, [{ playerId: 1, cmd: { t: 'move', unitIds: [f.id], to } }]);
      }
    }
    run(s, 1, w);
  }
  const minutes = w.out.unitTicks / 600;
  result.s4_jitter = {
    backPer100UnitMin: r1((w.out.back / Math.max(1, minutes)) * 100),
    stepsPerUnitMin: r1(w.out.steps / Math.max(1, minutes)),
    slotChangesPerUnitMin: r1(w.out.slotChanges / Math.max(1, minutes)),
  };
}

// ---------------------------------------------------------------- С5. Червяки (п.6)
{
  // Восемь вариантов рваной границы и расстановки врага: исход боя одного варианта случаен, среднее — нет.
  const agg = {
    hexes: 0,
    thin: 0,
    thin120: 0,
    encircled: 0,
    lost: 0,
    soldiers: 0,
    back: 0,
    unitTicks: 0,
    runs: 0,
  };
  for (let variant = 0; variant < Number(process.env.S5_N ?? 8); variant += 1) {
    const marks = new Map<string, string>([
      ['0,0', 'A1'],
      ['29,10', 'B1'],
      ['20,4', 'B2'],
      ['20,15', 'B3'],
    ]);
    const s = game({
      cols: 30,
      rows: 22,
      border: (r) => 11 + ((r * (3 + variant)) % (3 + (variant % 3))),
      marks,
    });
    let n = 0;
    for (let c = 4; c < 11 && n < 70; c += 1) {
      for (let r = 1; r < 21 && n < 70; r += 1) {
        s.unit('A', 'infantry', 300, at(c, r));
        n += 1;
      }
    }
    for (let r = 1; r < 21; r += 1) s.unit('B', 'infantry', 300, at(13 + ((r + variant) % 3), r));
    for (let r = 2; r < 20; r += 3) s.unit('B', 'artillery', 300, at(17, r));
    const base = hexesOf(s);
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 30000 } },
    ]);
    const w = watcher(s, 0);
    const startUnits = mine(s).length;
    const thinTips = (): number => {
      const { width, height } = s.state.map;
      let tips = 0;
      for (let h = 0; h < s.state.hexes.owner.length; h += 1) {
        if (s.state.hexes.owner[h] !== 0 || s.state.map.terrain[h] === 0) continue;
        const here = hexFromId(h, width);
        let own = 0;
        for (const q of neighbors(here)) {
          if (q.q < 0 || q.r < 0 || q.q >= width || q.r >= height) continue;
          if (s.state.hexes.owner[q.q + q.r * width] === 0) own += 1;
        }
        if (own <= 1) tips += 1;
      }
      return tips;
    };
    run(s, 1200, w);
    agg.thin120 += thinTips();
    run(s, 1200, w);
    agg.hexes += hexesOf(s) - base;
    agg.thin += thinTips();
    agg.encircled += w.out.encircled;
    agg.lost += startUnits - mine(s).length;
    agg.soldiers += soldiers(mine(s));
    agg.back += w.out.back;
    agg.unitTicks += w.out.unitTicks;
    agg.runs += 1;
  }
  result.s5_worms = {
    variants: agg.runs,
    hexesGained240: r1(agg.hexes / agg.runs),
    thinTips120: r1(agg.thin120 / agg.runs),
    thinTips240: r1(agg.thin / agg.runs),
    encircleEpisodes: r1(agg.encircled / agg.runs),
    unitsLost: r1(agg.lost / agg.runs),
    soldiersLeft240: r1(agg.soldiers / agg.runs),
    backPer100UnitMin: r1((agg.back / Math.max(1, agg.unitTicks / 600)) * 100),
  };
}

console.log(JSON.stringify(result, null, 2));
