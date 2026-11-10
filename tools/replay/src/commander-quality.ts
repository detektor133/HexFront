// Качество командира в матче ботов (замер до/после правок): простаивающие в тылу отряды,
// перебежки, рывок при объявлении войны, окружения «червячков», кривые линии наступления.
// Запуск: pnpm --filter @hexfront/replay quality [игроков] [сид] [секунд] [карта small|gen]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { generateMap } from '../../../packages/mapgen/src/index.ts';
import { commanderLine } from '../../../packages/sim/src/bots/commander-line.ts';
import { pickAxes } from '../../../packages/sim/src/commands/axis.ts';
import { blocOf, borderPieces } from '../../../packages/sim/src/commands/launch.ts';
import {
  atWar,
  borderEdges,
  botCommands,
  checkRecruit,
  cityPopCap,
  recruitCapacity,
  edgeOther,
  commanderCommands,
  createBotTickContext,
  createMatch,
  distance,
  edgeHex,
  FP,
  hexFromId,
  hexPopCap,
  loadMap,
  neighbors,
  step,
  TICKS_PER_S,
  type Command,
  type MatchState,
  type PlayerCommand,
  type Unit,
} from '../../../packages/sim/src/index.ts';
import { addUnit } from '../../../packages/sim/src/state/unit-index.ts';
import { lineRuns } from '../../../packages/sim/src/systems/offensive.ts';

const root = new URL('../../../', import.meta.url);
const PLAYERS = Number(process.argv[2] ?? 12);
const SEED = Number(process.argv[3] ?? 42);
const SECONDS = Number(process.argv[4] ?? 900);
const MAP_KIND = process.argv[5] ?? 'gen';
/** Режим «человек»: игрок 0 командует армиями как человек (без слияния мелких, как commander игрока), остальные — боты. Замеры — только по нему. */
const HUMAN = process.argv[6] === 'human';
const FOCUS = HUMAN ? 0 : -1;
/** Дуэль: у соперника-бота те же деньги, люди и подарок, а командует им бот, — чистое сравнение командиров. */
const DUEL = process.env.DUEL === '1';
const RICH = DUEL ? [0, 1] : [0];
const counted = (p: number): boolean => FOCUS < 0 || p === FOCUS;
const SAMPLE_TICKS = 100;
/** Отряд простаивает «в тылу»: стоит дольше минуты и дальше этого числа гексов от земли врага. */
const REAR_IDLE_TICKS = 600;
const REAR_DISTANCE = 10;
/** Возврат в гекс, из которого вышел, быстрее этого — перебежка. */
const BACK_TICKS = 300;
/** Окно после объявления войны, за которое смотрим приказы. */
const RUSH_WINDOW_TICKS = 600;
const RUSH_FAR = 12;
/** Линия наступления: гекс дальше от фронта, чем глубина линии + запас, — «улетела». */
const LINE_SPREAD_BAD = 8;

const mapJson =
  MAP_KIND === 'gen'
    ? generateMap(SEED, { width: 80, height: 60, players: PLAYERS })
    : JSON.parse(readFileSync(new URL('packages/mapgen/maps/small.json', root), 'utf8'));
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const state: MatchState = createMatch(
  loaded.map,
  Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i}` })),
  SEED,
  { diplomacy: true, ...(process.env.DUEL === '1' ? { noVictory: true } : {}) },
);
const bots = state.players.map((p) => p.id);
if (HUMAN) {
  const me = state.players[FOCUS];
  if (me) me.autoCommand = false;
  for (const army of state.armies) if (army.owner === FOCUS) army.auto = false;
}
/** Позиции боевых отрядов игрока в момент объявления им войны и срок, когда их сверять (пункт 5). */
/** Итоги войны «человека»: сила и земля через 1, 3 и 5 минут после объявления войны. */
let warStart = null as {
  tick: number;
  soldiers: number;
  hexes: number;
  foe: number;
  foeSoldiers: number;
} | null;
const outcome: Record<string, number> = {};
const soldiersOf = (p: number): number =>
  Math.round(state.units.filter((u) => u.owner === p).reduce((x, u) => x + u.soldiers, 0) / FP);
const hexesOf = (p: number): number => state.hexes.owner.filter((o) => o === p).length;
let rushSnapshot = null as { due: number; at: Map<number, number> } | null;
const commanderBots = HUMAN ? bots.filter((p) => p !== FOCUS) : bots;

interface Memory {
  hex: number;
  lastMove: number;
  prev: { hex: number; tick: number } | null;
  encircled: boolean;
  slot: number;
  /** Прошлый тик отряд стоял на своём месте: уход с него — перебежка. */
  seated: boolean;
}
const memory = new Map<number, Memory>();

const tally = {
  samplesWar: 0,
  combatUnitsWar: 0,
  restUnits: 0,
  restSoldiers: 0,
  warSoldiers: 0,
  longRestUnits: 0,
  artUnitsWar: 0,
  artRest: 0,
  stepsWar: 0,
  stepsPeace: 0,
  backWar: 0,
  backPeace: 0,
  unitTicksWar: 0,
  unitTicksPeace: 0,
  encircleEpisodes: 0,
  lost: 0,
  captured: 0,
  rushOrders: 0,
  rushDist: 0,
  rushFar: 0,
  wars: 0,
  lines: 0,
  lineEdges: 0,
  lineBad: 0,
  lineJumpy: 0,
  lineSpreadMax: 0,
  lineSpreadSum: 0,
  recruitOrders: 0,
  goldWarSum: 0,
  goldWarN: 0,
  standReserve: 0,
  standNoPlan: 0,
  standNoSlot: 0,
  standOnPlan: 0,
  strikeUnits: 0,
  farFromAxis: 0,
  slotChanges: 0,
  leaveWar: 0,
  leavePeace: 0,
  standWait: 0,
  axes: 0,
  axisDist: 0,
  probeLines: 0,
  probeEdges: 0,
  probeSpread: 0,
  rushUnits: 0,
  rushMoved: 0,
  rushFarUnits: 0,
  probeBadSpread: 0,
  probeBroken: 0,
  probeLong: 0,
};
const lineExamples: {
  tick: number;
  player: number;
  spread: number;
  jumps: number;
  edges: number;
}[] = [];
const rejects = new Map<string, number>();
const leaveCause = new Map<string, number>();
const backCause = new Map<string, number>();
const rushWatch = new Map<number, number>();
const timeline: { s: number; soldiers: number; units: number; gold: number; rest: number }[] = [];

function warring(p: number): boolean {
  return state.players.some(
    (q) => q.id !== p && q.status === 'alive' && atWar(state, p, q.id) && ownsHexes(q.id),
  );
}
const owned = new Map<number, number>();
function ownsHexes(p: number): boolean {
  return (owned.get(p) ?? 0) > 0;
}

/** Расстояние в гексах до ближайшей земли врагов игрока (поиск в ширину от неё). */
function enemyDistance(p: number): Int16Array {
  const { width, height } = state.map;
  const dist = new Int16Array(width * height).fill(-1);
  const queue: number[] = [];
  for (let h = 0; h < dist.length; h += 1) {
    const o = state.hexes.owner[h] ?? -1;
    if (o >= 0 && o !== p && atWar(state, p, o)) {
      dist[h] = 0;
      queue.push(h);
    }
  }
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as number;
    for (const n of neighbors(hexFromId(h, width))) {
      if (n.q < 0 || n.r < 0) continue;
      const id = n.q + n.r * width;
      if (n.q >= width || n.r >= height || (dist[id] ?? 0) !== -1) continue;
      dist[id] = (dist[h] as number) + 1;
      queue.push(id);
    }
  }
  return dist;
}

function checkLine(cmd: Extract<Command, { t: 'setOffensiveLine' }>, player: number): void {
  const plan = state.plans.find((p) => p.armyId === cmd.armyId);
  if (plan?.kind !== 'front') return;
  const { width } = state.map;
  const front = plan.edges.map((e) => hexFromId(edgeHex(e), width));
  for (const line of cmd.lines ?? [cmd.edges]) {
    if (line.length === 0) continue;
    let spread = 0;
    let jumps = 0;
    let before: ReturnType<typeof hexFromId> | null = null;
    for (const e of line) {
      const at = hexFromId(edgeHex(e), width);
      let best = Number.MAX_SAFE_INTEGER;
      for (const f of front) best = Math.min(best, distance(at, f));
      spread = Math.max(spread, best);
      if (before && distance(before, at) > 2) jumps += 1;
      before = at;
    }
    tally.lines += 1;
    tally.lineEdges += line.length;
    tally.lineSpreadSum += spread;
    tally.lineSpreadMax = Math.max(tally.lineSpreadMax, spread);
    if (spread > LINE_SPREAD_BAD) tally.lineBad += 1;
    if (jumps > 0) tally.lineJumpy += 1;
    if (spread > LINE_SPREAD_BAD || jumps > 0) {
      lineExamples.push({ tick: state.tick, player, spread, jumps, edges: line.length });
    }
  }
}

/**
 * Пробный выбор осей и линий так, как их строит направление игрока 0 (пункт 2 и 5): линия должна
 * лежать вдоль своего участка границы, одной цепочкой, а ось — рядом с войсками игрока.
 */
function probeStrikes(): void {
  if (!HUMAN || state.tick % 300 !== 0) return;
  const { width } = state.map;
  const mine = state.units.filter((u) => u.owner === FOCUS && u.type !== 'artillery');
  if (mine.length === 0) return;
  let cq = 0;
  let cr = 0;
  for (const u of mine) {
    const h = hexFromId(u.hex, width);
    cq += h.q;
    cr += h.r;
  }
  const center = { q: Math.round(cq / mine.length), r: Math.round(cr / mine.length) };
  for (const target of neighborsOf(FOCUS)) {
    if (!atWar(state, FOCUS, target)) continue;
    const pieces = borderPieces(state, FOCUS, target);
    const enemy = blocOf(state, FOCUS, target);
    const byHex = new Map<number, number>();
    for (const u of mine) byHex.set(u.hex, (byHex.get(u.hex) ?? 0) + Math.floor(u.soldiers / FP));
    const forces = [...byHex]
      .sort((a, b) => a[0] - b[0])
      .map(([hex, soldiers]) => ({ hex, soldiers }));
    const strike = pickAxes(state, FOCUS, enemy, pieces, HUMAN_SOLDIERS, [], undefined, forces);
    for (const w of strike.windows) {
      const mid = hexFromId(edgeHex(w[Math.floor(w.length / 2)] as number), width);
      tally.axes += 1;
      tally.axisDist += distance(center, mid);
      const line = commanderLine(
        state.map,
        { hexes: state.hexes, cities: state.cities },
        w,
        enemy,
        strike.depth,
      );
      if (line.length === 0) continue;
      const win = w.map((e) => hexFromId(edgeHex(e), width));
      let spread = 0;
      for (const e of line) {
        const at = hexFromId(edgeHex(e), width);
        spread = Math.max(spread, Math.min(...win.map((x) => distance(x, at))));
      }
      const runs = lineRuns(state, line).length;
      tally.probeLines += 1;
      tally.probeEdges += line.length;
      tally.probeSpread += spread;
      if (spread > strike.depth + 2) tally.probeBadSpread += 1;
      if (runs > 1) {
        tally.probeBroken += 1;
        if (DUMP && dumped < 3) {
          dumped += 1;
          mkdirSync(DUMP, { recursive: true });
          writeFileSync(
            `${DUMP}/broken-${SEED}-${dumped}.json`,
            JSON.stringify({
              me: FOCUS,
              target,
              width: state.map.width,
              height: state.map.height,
              owner: Array.from(state.hexes.owner),
              terrain: Array.from(state.map.terrain),
              window: w.map((e) => edgeHex(e)),
              windowDirs: w.map((e) => e),
              line: line.map((e) => edgeHex(e)),
              runs: lineRuns(state, line).map((r) => r.map((e) => edgeHex(e))),
              units: state.units.filter((u) => u.owner === FOCUS).map((u) => u.hex),
            }),
          );
        }
      }
      if (line.length > 3 * w.length + 12) tally.probeLong += 1;
    }
  }
}

function observeCommands(cmds: readonly PlayerCommand[]): void {
  for (const c of cmds) {
    const cmd = c.cmd;
    if (cmd.t === 'recruit' && counted(c.playerId)) tally.recruitOrders += 1;
    if (c.source !== 'auto' || !counted(c.playerId)) continue;
    if (cmd.t === 'setOffensiveLine') checkLine(cmd, c.playerId);
    if (
      (cmd.t === 'move' || cmd.t === 'attack') &&
      (rushWatch.get(c.playerId) ?? -1) > state.tick
    ) {
      const to = cmd.t === 'move' ? cmd.to : cmd.target;
      const u = state.units.find((x) => x.id === cmd.unitIds[0]);
      if (!u) continue;
      const d = distance(hexFromId(u.hex, state.map.width), hexFromId(to, state.map.width));
      tally.rushOrders += 1;
      tally.rushDist += d;
      if (d > RUSH_FAR) tally.rushFar += 1;
    }
  }
}

function afterStep(warNow: ReadonlyMap<number, boolean>): void {
  for (const e of state.events) {
    if (e.t === 'commandRejected' && counted(e.playerId)) {
      const k = `${e.command}:${e.reason}`;
      rejects.set(k, (rejects.get(k) ?? 0) + 1);
    }
    if (e.t === 'warDeclared' && HUMAN && e.playerId === FOCUS && warStart === null) {
      warStart = {
        tick: state.tick,
        soldiers: soldiersOf(FOCUS),
        hexes: hexesOf(FOCUS),
        foe: e.targetId,
        foeSoldiers: soldiersOf(e.targetId),
      };
    }
    if (e.t === 'warDeclared' && HUMAN && e.playerId === FOCUS && rushSnapshot === null) {
      rushSnapshot = {
        due: state.tick + RUSH_WINDOW_TICKS,
        at: new Map(
          state.units
            .filter((u) => u.owner === FOCUS && u.type !== 'artillery')
            .map((u) => [u.id, u.hex] as const),
        ),
      };
    }
    if (e.t === 'warDeclared') {
      if (counted(e.playerId) || counted(e.targetId)) tally.wars += 1;
      rushWatch.set(e.playerId, state.tick + RUSH_WINDOW_TICKS);
      rushWatch.set(e.targetId, state.tick + RUSH_WINDOW_TICKS);
    }
    if ((e.t === 'unitDestroyed' || e.t === 'unitCapitulated') && counted(e.playerId))
      tally.lost += 1;
    if (e.t === 'cityCaptured') tally.captured += 1;
  }
  for (const u of state.units) {
    if (!counted(u.owner)) continue;
    const war = warNow.get(u.owner) ?? false;
    const m = memory.get(u.id);
    if (!m) {
      memory.set(u.id, {
        hex: u.hex,
        lastMove: state.tick,
        prev: null,
        encircled: u.encircled,
        slot: u.slot,
        seated: false,
      });
      continue;
    }
    if (war) tally.unitTicksWar += 1;
    else tally.unitTicksPeace += 1;
    if (u.hex !== m.hex) {
      if (war) tally.stepsWar += 1;
      else tally.stepsPeace += 1;
      if (m.prev && m.prev.hex === u.hex && state.tick - m.prev.tick <= BACK_TICKS) {
        const army = state.armies.find((a) => a.id === u.armyId);
        const kind =
          army === undefined
            ? 'reserve'
            : army.dir === undefined
              ? 'nodir'
              : army.dir.target < 0
                ? 'neutral'
                : army.dir.mode;
        const bk = `${war ? 'war' : 'peace'}:${kind}:${u.slot >= 0 ? 'slot' : 'noslot'}:${u.order}`;
        backCause.set(bk, (backCause.get(bk) ?? 0) + 1);
        if (war) tally.backWar += 1;
        else tally.backPeace += 1;
      }
      m.prev = { hex: m.hex, tick: state.tick };
      m.hex = u.hex;
      m.lastMove = state.tick;
    }
    if (m.seated && u.order === 'move') {
      if (war) tally.leaveWar += 1;
      else tally.leavePeace += 1;
      // Причина ухода: новое место (пересмотр расстановки), шаг наступления (место снято) или иное.
      const cause = u.slot < 0 ? 'step' : u.slot !== m.slot ? 'reslot' : 'other';
      const key = `${war ? 'war' : 'peace'}:${cause}`;
      leaveCause.set(key, (leaveCause.get(key) ?? 0) + 1);
    }
    m.seated = u.order === 'idle' && u.slot >= 0 && u.hex === u.slot;
    if (u.slot >= 0 && m.slot >= 0 && u.slot !== m.slot) tally.slotChanges += 1;
    m.slot = u.slot;
    if (u.encircled && !m.encircled) tally.encircleEpisodes += 1;
    m.encircled = u.encircled;
  }
}

function sample(): void {
  const { width } = state.map;
  owned.clear();
  for (const o of state.hexes.owner) if (o >= 0) owned.set(o, (owned.get(o) ?? 0) + 1);
  let soldiers = 0;
  let units = 0;
  let gold = 0;
  let rest = 0;
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const mine = state.units.filter((u) => u.owner === p.id);
    if (!counted(p.id)) continue;
    soldiers += mine.reduce((s, u) => s + u.soldiers, 0) / FP;
    units += mine.length;
    gold += p.gold / FP;
    if (!counted(p.id) || !warring(p.id)) continue;
    tally.samplesWar += 1;
    tally.goldWarSum += p.gold / FP;
    tally.goldWarN += 1;
    const dist = enemyDistance(p.id);
    // Линии идущих наступлений игрока: «далеко от удара» — стоит дальше 10 гексов от каждой.
    const strikeHexes = state.plans.flatMap((pl) =>
      pl.kind === 'front' &&
      pl.offensive?.active &&
      state.armies.find((a) => a.id === pl.armyId)?.owner === p.id
        ? pl.offensive.hexes
        : [],
    );
    for (const u of mine) {
      if (u.sea) continue;
      const isArt = u.type === 'artillery';
      const d = dist[u.hex] ?? -1;
      if (isArt) tally.artUnitsWar += 1;
      else tally.combatUnitsWar += 1;
      tally.warSoldiers += u.soldiers / FP;
      const standing =
        u.order === 'idle' &&
        !u.inBattle &&
        state.tick - (memory.get(u.id)?.lastMove ?? 0) >= REAR_IDLE_TICKS;
      if (!isArt && strikeHexes.length > 0) {
        tally.strikeUnits += 1;
        const here = hexFromId(u.hex, width);
        let nearest = Number.MAX_SAFE_INTEGER;
        for (const h of strikeHexes)
          nearest = Math.min(nearest, distance(here, hexFromId(h, width)));
        if (standing && nearest > 10) tally.farFromAxis += 1;
      }
      if (standing && !isArt && u.slot >= 0 && u.hex !== u.slot) tally.standWait += 1;
      if (standing && !isArt) {
        const plan = u.armyId === null ? undefined : state.plans.find((x) => x.armyId === u.armyId);
        if (u.armyId === null) tally.standReserve += 1;
        else if (!plan) tally.standNoPlan += 1;
        else if (u.slot < 0) tally.standNoSlot += 1;
        else tally.standOnPlan += 1;
      }
      if (standing && d >= REAR_DISTANCE) {
        if (isArt) tally.artRest += 1;
        else {
          tally.restUnits += 1;
          rest += 1;
          tally.restSoldiers += u.soldiers / FP;
          if (state.tick - (memory.get(u.id)?.lastMove ?? 0) >= 6 * REAR_IDLE_TICKS) {
            tally.longRestUnits += 1;
          }
        }
      }
    }
    void width;
  }
  const alive = FOCUS >= 0 ? 1 : state.players.filter((p) => p.status === 'alive').length || 1;
  timeline.push({
    s: state.tick / TICKS_PER_S,
    soldiers: Math.round(soldiers / alive),
    units: Math.round(units / alive),
    gold: Math.round(gold / alive),
    rest,
  });
}

/** Соседи с общей границей у игрока (по порядку id). */
function neighborsOf(p: number): number[] {
  const out = new Set<number>();
  for (const e of borderEdges(state, p)) {
    const o = state.hexes.owner[edgeOther(state, e)] ?? -1;
    if (o >= 0 && o !== p && state.players[o]?.status === 'alive') out.add(o);
  }
  return [...out].sort((a, b) => a - b);
}

/** Команды «человека» (игрок 0): держать границу с соседями, затем ударить по первому из них. */
const directed = new Set<number>();
const directedWar = new Set<number>();
function humanCommands(): PlayerCommand[] {
  if (!HUMAN || state.tick % (30 * TICKS_PER_S) !== 0) return [];
  const sec = state.tick / TICKS_PER_S;
  const out: PlayerCommand[] = [];
  const mine = neighborsOf(FOCUS);
  // Пока соседей нет, «человек» растёт: клик по ничьей земле у границы (направление на ничью землю).
  if (sec < 240 && sec % 60 === 0) {
    const { width, height } = state.map;
    const spot = [];
    for (let h = 0; h < state.hexes.owner.length; h += 1) {
      if (state.hexes.owner[h] !== -1 || state.map.terrain[h] === 0) continue;
      const here = hexFromId(h, width);
      if (
        neighbors(here).some(
          (n) =>
            n.q >= 0 &&
            n.r >= 0 &&
            n.q < width &&
            n.r < height &&
            state.hexes.owner[n.q + n.r * width] === FOCUS,
        )
      )
        spot.push(h);
    }
    const pick = spot[(sec / 60) % Math.max(1, spot.length)];
    if (pick !== undefined) {
      out.push({
        playerId: FOCUS,
        cmd: { t: 'launchOffensive', target: -1, soldiers: 4000, hex: pick, armyId: -1 },
      });
    }
  }
  for (const q of mine) {
    if (sec >= 60 && !directed.has(q) && !atWarOnly(q)) {
      directed.add(q);
      out.push({ playerId: FOCUS, cmd: { t: 'holdBorder', target: q, soldiers: HUMAN_SOLDIERS } });
    }
  }
  // В 300 с «человек» объявляет войну первому соседу и бьёт по нему.
  const victim = mine.find((q) => !directedWar.has(q));
  if (sec >= 300 && victim !== undefined && directedWar.size === 0) {
    directedWar.add(victim);
    out.push({ playerId: FOCUS, cmd: { t: 'declareWar', target: victim } });
  }
  for (const q of directedWar) {
    if (atWar(state, FOCUS, q) && !directed.has(1000 + q)) {
      directed.add(1000 + q);
      out.push({
        playerId: FOCUS,
        cmd: { t: 'launchOffensive', target: q, soldiers: HUMAN_SOLDIERS },
      });
    }
  }
  return out;
}
const atWarOnly = (q: number): boolean => !atWar(state, FOCUS, q);
const HUMAN_SOLDIERS = 30000;
const DUMP = process.env.DUMP ?? '';
let dumped = 0;
/** Из команд мозга игроку-«человеку» оставляем экономику: армиями и отрядами он командует сам. */
const ARMY_FREE = new Set<string>([
  'setTax',
  'recruit',
  'foundCity',
  'upgradeCity',
  'improve',
  'build',
  'rebuildSupply',
  'proposeTreaty',
  'answerTreaty',
]);

/** «Подарок»: у игрока 0 в 240 с появляется крупный резерв по всей стране — пехота и батарея, как у игрока, накопившего «сотню фишек». */
let gifted = false;
function giftReserve(): void {
  if (!HUMAN || gifted || state.tick < 240 * TICKS_PER_S) return;
  gifted = true;
  for (const who of RICH) giftTo(who);
}

function giftTo(who: number): void {
  const land = [];
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] === who && state.map.terrain[h] !== 0) land.push(h);
  }
  const step = Math.max(1, Math.floor(land.length / 96));
  for (let i = 0; i < 90 && land.length > 0; i += 1) {
    const type = i % 8 === 7 ? 'artillery' : 'infantry';
    const unit: Unit = {
      id: state.nextId,
      owner: who,
      type,
      soldiers: (300 * FP) as Unit['soldiers'],
      org: state.units[0]?.org ?? ((100 * FP) as Unit['org']),
      hex: land[(i * step) % land.length] as number,
      order: 'idle',
      supplyLevel: FP as Unit['supplyLevel'],
      path: [],
      moveTicks: 0,
      moveTotal: 0,
      armyId: null,
      lowSupplyTicks: 0,
      encircled: false,
      sea: false,
      seaFrom: -1,
      target: -1,
      inBattle: false,
      focus: -1,
      fireTarget: -1,
      slot: -1,
      gather: -1,
    };
    addUnit(state, unit);
    state.nextId += 1;
  }
}

const started = Date.now();
const limit = SECONDS * TICKS_PER_S;
while (state.winner < 0 && state.tick < limit) {
  // «Человек» играет богато: золото не мешает добору (замер командира, а не экономики).
  if (HUMAN && state.tick % 100 === 0) {
    for (const who of RICH) {
      const p = state.players[who];
      if (p && p.gold < 3000 * FP) p.gold = (3000 * FP) as typeof p.gold;
      // И люди: население держится у предела, как в поздней игре, — упираться должен командир, а не набор.
      if (state.tick % 100 === 0) {
        for (let h = 0; h < state.hexes.owner.length; h += 1) {
          if (state.hexes.owner[h] !== who) continue;
          const city = state.cities.find((c) => c.hex === h);
          const cap = city ? cityPopCap(city.level) : hexPopCap(state, h);
          if ((state.hexes.pop[h] ?? 0) < cap) state.hexes.pop[h] = cap;
        }
      }
    }
  }
  if (
    process.env.TRACE2 &&
    HUMAN &&
    state.tick >= 1000 &&
    state.tick < 1100 &&
    state.tick % 10 === 0
  ) {
    const c = state.cities.find((x) => x.owner === FOCUS);
    console.error(
      `t=${state.tick} recruits=${state.recruits.length} mine=${state.recruits.filter((r) => r.owner === FOCUS).length} cityBusy=${state.recruits.some((r) => r.cityId === c?.id)} check=${c ? JSON.stringify(checkRecruit(state, FOCUS, c.id, 'infantry', (300 * FP) as never)) : '-'}`,
    );
  }
  if (process.env.TRACE && HUMAN && state.tick % 600 === 0) {
    const mine = state.units.filter((u) => u.owner === FOCUS);
    const armies = state.armies
      .filter((a) => a.owner === FOCUS)
      .map((a) => {
        const us = mine.filter((u) => u.armyId === a.id);
        return `#${a.id}(w${a.wanted ?? '-'} dir${a.dir ? a.dir.target + a.dir.mode.charAt(0) : '-'} n${us.length} s${Math.round(us.reduce((x, u) => x + u.soldiers, 0) / FP)} plan${state.plans.some((p) => p.armyId === a.id) ? 1 : 0})`;
      });
    for (const c of state.cities.filter((x) => x.owner === FOCUS)) {
      const chk = checkRecruit(state, FOCUS, c.id, 'infantry', (300 * FP) as never);
      console.error(
        `  city ${c.id} cap=${Math.round(recruitCapacity(state, c.id) / FP)} check=${chk.ok ? 'ok' : chk.reason}`,
      );
    }
    const reserve = mine.filter((u) => u.armyId === null);
    console.error(
      `t=${state.tick / 10} units=${mine.length} reserve=${reserve.length}/${Math.round(reserve.reduce((x, u) => x + u.soldiers, 0) / FP)} recruits=${state.recruits.filter((r) => r.owner === FOCUS).length} gold=${Math.round((state.players[FOCUS]?.gold ?? 0) / FP)} armies ${armies.join(' ')}`,
    );
  }
  giftReserve();
  if (state.tick % SAMPLE_TICKS === 0) sample();
  const warNow = new Map(state.players.map((p) => [p.id, warring(p.id)]));
  const context = createBotTickContext(state);
  const brain = botCommands(state, bots, context).filter(
    (c) => !HUMAN || c.playerId !== FOCUS || ARMY_FREE.has(c.cmd.t),
  );
  const cmds = [...commanderCommands(state, commanderBots, context), ...brain, ...humanCommands()];
  probeStrikes();
  observeCommands(cmds);
  step(state, cmds);
  afterStep(warNow);
  if (warStart) {
    const dt = state.tick - warStart.tick;
    const mark = (
      at: number,
      key: 's60' | 's180' | 's300',
      hkey: 'h60' | 'h180' | 'h300',
    ): void => {
      if (dt !== at * TICKS_PER_S || !warStart) return;
      outcome[key] = Math.round((soldiersOf(FOCUS) / Math.max(1, warStart.soldiers)) * 100);
      outcome[`foe${key}`] = Math.round(
        (soldiersOf(warStart.foe) / Math.max(1, warStart.foeSoldiers)) * 100,
      );
      // Во сколько раз врага убито больше, чем потеряно своих.
      const mineLost = Math.max(1, warStart.soldiers - soldiersOf(FOCUS));
      outcome[`kill${key}`] =
        Math.round(((warStart.foeSoldiers - soldiersOf(warStart.foe)) / mineLost) * 100) / 100;
      outcome[`foeHex${hkey}`] = hexesOf(warStart.foe);
      outcome[hkey] = hexesOf(FOCUS) - warStart.hexes;
    };
    if (DUMP && [900, 1800, 2700].includes(dt)) {
      mkdirSync(DUMP, { recursive: true });
      writeFileSync(
        `${DUMP}/snap-${SEED}-${dt}.json`,
        JSON.stringify({
          me: FOCUS,
          target: [...directedWar][0],
          width: state.map.width,
          height: state.map.height,
          owner: Array.from(state.hexes.owner),
          terrain: Array.from(state.map.terrain),
          window: [],
          line: [],
          runs: [],
          units: state.units.filter((u) => u.owner === FOCUS).map((u) => u.hex),
          enemyUnits: state.units.filter((u) => u.owner === [...directedWar][0]).map((u) => u.hex),
        }),
      );
    }
    mark(60, 's60', 'h60');
    mark(180, 's180', 'h180');
    mark(300, 's300', 'h300');
  }
  if (rushSnapshot && state.tick === rushSnapshot.due) {
    for (const u of state.units) {
      const from = rushSnapshot.at.get(u.id);
      if (from === undefined) continue;
      const d = distance(hexFromId(from, state.map.width), hexFromId(u.hex, state.map.width));
      tally.rushUnits += 1;
      tally.rushMoved += d;
      if (d > RUSH_FAR) tally.rushFarUnits += 1;
    }
  }
}

const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
const per = (a: number, b: number, k: number): number =>
  b === 0 ? 0 : Math.round((a / b) * k * 100) / 100;
const minutes = (t: number): number => t / (60 * TICKS_PER_S);
const unitMinutesWar = minutes(tally.unitTicksWar);
const unitMinutesPeace = minutes(tally.unitTicksPeace);
const at = (s: number) => [...timeline].reverse().find((x) => x.s <= s);
const report = {
  players: PLAYERS,
  seed: SEED,
  map: MAP_KIND,
  endS: state.tick / TICKS_PER_S,
  wallS: Math.round((Date.now() - started) / 1000),
  wars: tally.wars,
  // п.1: боевые отряды (не артиллерия) воюющих игроков, стоящие ≥ 60 с дальше 10 гексов от врага.
  restUnitsPct: pct(tally.restUnits, tally.combatUnitsWar),
  restSoldiersPct: pct(tally.restSoldiers, tally.warSoldiers),
  restLongUnitsPct: pct(tally.longRestUnits, tally.combatUnitsWar),
  standingReservePct: pct(tally.standReserve, tally.combatUnitsWar),
  standingNoPlanPct: pct(tally.standNoPlan, tally.combatUnitsWar),
  standingNoSlotPct: pct(tally.standNoSlot, tally.combatUnitsWar),
  standingOnPlanPct: pct(tally.standOnPlan, tally.combatUnitsWar),
  standingWaitingForRoutePct: pct(tally.standWait, tally.combatUnitsWar),
  farFromAxisPct: pct(tally.farFromAxis, tally.strikeUnits),
  seatedLeavesWarPer100: per(tally.leaveWar, unitMinutesWar, 100),
  seatedLeavesPeacePer100: per(tally.leavePeace, unitMinutesPeace, 100),
  slotChangesPerUnitMin: per(tally.slotChanges, unitMinutesWar, 1),
  restArtilleryPct: pct(tally.artRest, tally.artUnitsWar),
  // п.4: возвраты в только что покинутый гекс на 100 отряд-минут и шаги на отряд-минуту.
  backWarPer100: per(tally.backWar, unitMinutesWar, 100),
  backPeacePer100: per(tally.backPeace, unitMinutesPeace, 100),
  stepsPeacePerUnitMin: per(tally.stepsPeace, unitMinutesPeace, 1),
  stepsWarPerUnitMin: per(tally.stepsWar, unitMinutesWar, 1),
  // п.5: приказы командира в минуту после объявления войны.
  warStartSoldiers: warStart?.soldiers ?? null,
  foeLeftPct180: outcome.foes180 ?? null,
  foeLeftPct300: outcome.foes300 ?? null,
  killRatio180: outcome.kills180 ?? null,
  killRatio300: outcome.kills300 ?? null,
  foeHexes300: outcome.foeHexh300 ?? null,
  armyLeftPct60: outcome.s60 ?? null,
  armyLeftPct180: outcome.s180 ?? null,
  armyLeftPct300: outcome.s300 ?? null,
  hexesGained60: outcome.h60 ?? null,
  hexesGained180: outcome.h180 ?? null,
  hexesGained300: outcome.h300 ?? null,
  rushUnitsWatched: tally.rushUnits,
  rushUnitMeanDisplacement: per(tally.rushMoved, tally.rushUnits, 1),
  rushUnitFarPct: pct(tally.rushFarUnits, tally.rushUnits),
  rushOrders: tally.rushOrders,
  rushMeanDist: per(tally.rushDist, tally.rushOrders, 1),
  rushFarPct: pct(tally.rushFar, tally.rushOrders),
  // п.6: окружения своих отрядов и потери.
  encirclePer100UnitMin: per(tally.encircleEpisodes, unitMinutesWar, 100),
  unitsLost: tally.lost,
  citiesCaptured: tally.captured,
  // п.2: линии наступления.
  lines: tally.lines,
  lineAvgEdges: per(tally.lineEdges, tally.lines, 1),
  lineAvgSpread: per(tally.lineSpreadSum, tally.lines, 1),
  lineMaxSpread: tally.lineSpreadMax,
  lineBadPct: pct(tally.lineBad, tally.lines),
  lineJumpyPct: pct(tally.lineJumpy, tally.lines),
  // п.3: наём.
  recruitOrders: tally.recruitOrders,
  goldWarAvg: per(tally.goldWarSum, tally.goldWarN, 1),
  soldiersAvgPerPlayer: { m5: at(300)?.soldiers, m10: at(600)?.soldiers, m15: at(900)?.soldiers },
  unitsAvgPerPlayer: { m5: at(300)?.units, m10: at(600)?.units, m15: at(900)?.units },
  probeAxes: tally.axes,
  probeAxisMeanDistToArmy: per(tally.axisDist, tally.axes, 1),
  probeLines: tally.probeLines,
  probeLineAvgEdges: per(tally.probeEdges, tally.probeLines, 1),
  probeLineAvgSpread: per(tally.probeSpread, tally.probeLines, 1),
  probeBadSpreadPct: pct(tally.probeBadSpread, tally.probeLines),
  probeBrokenPct: pct(tally.probeBroken, tally.probeLines),
  probeLongPct: pct(tally.probeLong, tally.probeLines),
  leaveCauses: Object.fromEntries([...leaveCause].sort()),
  backCauses: Object.fromEntries([...backCause].sort()),
  rejected: Object.fromEntries([...rejects].sort((a, b) => b[1] - a[1]).slice(0, 6)),
  lineExamples: lineExamples.slice(0, 5),
};
console.log(JSON.stringify(report, null, 2));
