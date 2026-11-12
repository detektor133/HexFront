// Автокомандование армии (CR-006; gdd/07-controls.md, «Автокомандование»): чистая функция снимка
// игрока — без случайности и мутаций, стабильный порядок команд. Война — фронт на непрерывный кусок
// границы с врагом (не больше одной армии на кусок), свои потерянные гексы у фронта — отбить; ничья
// земля — занять без плана, нейтральный город — штурм при прогнозе «успех», в приоритете; ▶ без
// линии — построить линию; лишние отряды резерва — в самую слабую армию. Сам на игроков не наступает.
import { breakout } from './commander-breakout.ts';
import { commanderLine } from './commander-line.ts';
import { strike } from './commander-strike.ts';
import { frontForces, needsLine, stance } from './commander-war.ts';
import { warWith } from './war.ts';
import {
  AXIS_DONE_PERCENT,
  AXIS_MAX,
  BOT_AXIS_EDGES,
  BOT_PROFILES,
  COMMANDER_TICKS,
  type BotProfile,
  EXPAND_COMPACT_WEIGHT,
  FRONT_SPLIT_MIN,
  MAX_UNITS_PER_HEX,
  SWARM_SAFE,
} from '../balance.ts';
import type { Command } from '../commands/types.ts';
import { neighborTable, SIDES } from '../map/neighbor-table.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { fp, intDiv, type Fp } from '../math/int.ts';
import { forecastBattle } from '../queries/forecast.ts';
import type { PlanView } from '../queries/plan-view.ts';
import type { PlayerView } from '../queries/player-view.ts';
import type { UnitView } from '../queries/unit-view.ts';
import {
  borderEdges,
  borderSegmentEdges,
  edgeHex,
  edgeOf,
  edgeOther,
  isBorderEdge,
  type EdgeId,
} from '../state/edges.ts';
import { planExpansion } from '../state/expansion.ts';

type Ground = { map: MapStatic; hexes: { owner: Int16Array } };

function piecesOf(
  map: MapStatic,
  view: PlayerView,
  reserved: number | null,
  context: CommanderContext,
): Map<number, Piece> {
  const key = reserved ?? -1;
  const cached = context.assigned.get(key);
  if (cached) return cached;
  const result = assignPieces(map, view, context.enemyPieces, reserved);
  context.assigned.set(key, result);
  return result;
}

/** Непрерывный кусок своей границы с врагом. */
interface Piece {
  readonly enemy: number;
  readonly edges: readonly EdgeId[];
}

export interface CommanderContext {
  readonly emptyNeutral: readonly HexId[];
  readonly enemyPieces: readonly Piece[];
  /** Распределение кусков по армиям для одного снимка; ключ — резервная армия или -1. */
  readonly assigned: Map<number, Map<number, Piece>>;
}

/** Вес кольца вокруг столицы при выборе гекса: ядро растёт ровно, а не вытягивается за отрядом. */
const RING_WEIGHT = 5;

/** Как часто армия бота без линии наступления ищет её заново, тиков. */
const LINE_RETRY_TICKS = 50;

const hexOf = (map: MapStatic, h: HexId) => hexFromId(h, map.width);

// Куски границы с каждым врагом (до дипломатии все игроки — враги), по первой грани.
function enemyPieces(
  g: Ground,
  me: number,
  isEnemy: (player: number) => boolean,
  ownedHexes?: readonly HexId[],
): Piece[] {
  const out: Piece[] = [];
  const seen = new Set<EdgeId>();
  const borders = ownedHexes === undefined ? borderEdges(g, me) : borderEdgesOf(g, me, ownedHexes);
  for (const e of borders) {
    const enemy = g.hexes.owner[edgeOther(g, e)] ?? -1;
    if (!isEnemy(enemy) || seen.has(e)) continue;
    const edges = borderSegmentEdges(g, me, enemy, e);
    for (const x of edges) seen.add(x);
    if (edges.length > 0) out.push({ enemy, edges });
  }
  return out;
}

// Грани границы игрока среди его гексов: порядок гексов и направлений как у прежнего flatMap.
function borderEdgesOf(g: Ground, me: number, ownedHexes: readonly HexId[]): EdgeId[] {
  const out: EdgeId[] = [];
  for (const h of ownedHexes) {
    for (let direction = 0; direction < SIDES; direction += 1) {
      const e = edgeOf(h, direction);
      if (isBorderEdge(g, me, e)) out.push(e);
    }
  }
  return out;
}

const armyUnits = (view: PlayerView, armyId: number): UnitView[] =>
  view.units.filter((u) => u.owner === view.playerId && u.armyId === armyId);

// Куски → армии с auto: сначала армия, чей фронт уже на куске, затем ближайшая свободная с
// отрядами (при равенстве — меньший id). Одна армия — один кусок.
function assignPieces(
  map: MapStatic,
  view: PlayerView,
  pieces: readonly Piece[],
  reserved: number | null,
) {
  const auto = view.armies.filter((a) => a.auto && a.id !== reserved).map((a) => a.id);
  const taken = new Map<number, Piece>();
  const free = (id: number): boolean => !taken.has(id);
  for (const p of pieces) {
    const holder = auto.find((id) => {
      const plan = view.plans.find((x) => x.armyId === id);
      return free(id) && plan?.kind === 'front' && plan.edges.some((e) => p.edges.includes(e));
    });
    if (holder !== undefined) taken.set(holder, p);
  }
  for (const p of pieces) {
    if ([...taken.values()].includes(p)) continue;
    const hexes = p.edges.map((e) => hexOf(map, edgeHex(e)));
    let best: number | null = null;
    let bestD = Number.MAX_SAFE_INTEGER;
    for (const id of auto) {
      if (!free(id)) continue;
      for (const u of armyUnits(view, id)) {
        const d = Math.min(...hexes.map((h) => distance(h, hexOf(map, u.hex))));
        if (d < bestD) {
          best = id;
          bestD = d;
        }
      }
    }
    if (best !== null) taken.set(best, p);
  }
  return taken;
}

// Свободный для приказа отряд: стоит, не артиллерия, не в переходе.
const idle = (u: UnitView): boolean =>
  u.order === 'idle' && u.type !== 'artillery' && u.moveTotal === 0 && u.path.length === 0;

// Лишние отряды резерва — в самую слабую армию с auto (делает армия с auto с меньшим id).
function targetArmy(view: PlayerView): number | null {
  const plans = view.plans
    .filter((plan) => plan.kind === 'front' && (plan.startWanted || plan.offensive?.active))
    .map((plan) => plan.armyId)
    .sort((a, b) => a - b);
  return plans[0] ?? null;
}

function reinforce(view: PlayerView, armyId: number, bot: boolean): Command[] {
  const auto = view.armies.filter((a) => a.auto);
  const target = bot ? targetArmy(view) : null;
  if ((target ?? auto[0]?.id) !== armyId) return [];
  const soldiers = new Map(auto.map((a) => [a.id, 0]));
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId !== null && soldiers.has(u.armyId)) {
      soldiers.set(u.armyId, (soldiers.get(u.armyId) ?? 0) + u.soldiers);
    }
  }
  const out: Command[] = [];
  const destination = target ?? [...soldiers].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]?.[0];
  if (destination === undefined) return out;
  const reserve = view.units.filter(
    (u) => u.owner === view.playerId && u.armyId === null && u.order !== 'retreat',
  );
  for (const u of reserve) {
    out.push({ t: 'assignUnits', unitIds: [u.id], armyId: destination });
  }
  return out;
}

function mergeSmall(
  map: MapStatic,
  view: PlayerView,
  armyId: number,
  mergeBelow: Fp,
  mergeRadius: number,
): Command[] {
  const own = view.units.filter((unit) => unit.owner === view.playerId && unit.armyId === armyId);
  const out: Command[] = [];
  for (const small of own) {
    if (
      small.soldiers >= mergeBelow ||
      small.order !== 'idle' ||
      small.moveTotal !== 0 ||
      small.path.length > 0 ||
      small.inBattle
    ) {
      continue;
    }
    const target = own
      .filter((unit) => unit.id !== small.id && unit.type === small.type && !unit.inBattle)
      .map((unit) => ({ unit, distance: distance(hexOf(map, small.hex), hexOf(map, unit.hex)) }))
      .filter(({ distance: distanceTo }) => distanceTo <= mergeRadius && distanceTo > 0)
      .sort((a, b) => a.distance - b.distance || a.unit.id - b.unit.id)[0]?.unit;
    if (!target) continue;
    const atTarget = view.units.filter(
      (unit) => unit.owner === view.playerId && unit.hex === target.hex,
    );
    if (atTarget.length >= MAX_UNITS_PER_HEX) continue;
    out.push(
      small.hex === target.hex
        ? { t: 'merge', unitIds: [small.id, target.id] }
        : { t: 'move', unitIds: [small.id], to: target.hex },
    );
  }
  return out;
}

// Пустая армия экспансии получает один отряд с занятого фронта; донор не опустошается.
function seedExpansion(view: PlayerView, armyId: number, context: CommanderContext): Command[] {
  if (armyUnits(view, armyId).length > 0 || view.plans.some((p) => p.armyId === armyId)) return [];
  if (view.units.some((u) => u.owner === view.playerId && u.armyId === null)) return [];
  if (context.emptyNeutral.length === 0) return [];
  const donors = view.armies
    .filter((army) => army.id !== armyId && view.plans.some((p) => p.armyId === army.id))
    .map((army) => armyUnits(view, army.id).filter(idle))
    .filter((units) => units.length > 1)
    .sort((a, b) => b.length - a.length || (a[0]?.id ?? 0) - (b[0]?.id ?? 0));
  const unit = donors[0]?.sort((a, b) => a.soldiers - b.soldiers || a.id - b.id)[0];
  return unit ? [{ t: 'assignUnits', unitIds: [unit.id], armyId }] : [];
}

// Отбить свои потерянные гексы у фронта: ближайший свободный отряд, прогноз не «Поражение».
function retake(map: MapStatic, view: PlayerView, lost: readonly HexId[], units: UnitView[]) {
  const out: Command[] = [];
  const used = new Set<number>();
  for (const h of lost) {
    const holder = view.hexes.owner[h] ?? -1;
    if (holder < 0 || holder === view.playerId || !warWith(view, holder)) continue;
    const ready = units
      .filter((u) => idle(u) && !used.has(u.id))
      .sort(
        (a, b) =>
          distance(hexOf(map, a.hex), hexOf(map, h)) - distance(hexOf(map, b.hex), hexOf(map, h)) ||
          a.id - b.id,
      );
    const u = ready.find((x) => forecastBattle(map, view, [x.id], h).outcome !== 'defeat');
    if (!u) continue;
    used.add(u.id);
    out.push({ t: 'move', unitIds: [u.id], to: h });
  }
  return out;
}

// Цели занятия ничьей земли: пустые ничьи гексы у своей границы.
function emptyNeutral(map: MapStatic, view: PlayerView, ownedHexes?: readonly HexId[]): HexId[] {
  const owner = view.hexes.owner;
  let candidates: HexId[];
  if (ownedHexes === undefined) {
    const near = new Uint8Array(owner.length);
    for (let h = 0; h < owner.length; h += 1) {
      if (owner[h] !== view.playerId) continue;
      for (const n of neighbors(hexOf(map, h))) {
        if (inBounds(n, map.width, map.height)) near[hexId(n, map.width)] = 1;
      }
    }
    candidates = Array.from({ length: owner.length }, (_, h) => h as HexId).filter(
      (h) => near[h] === 1,
    );
  } else {
    // Соседи своих гексов по возрастанию id: отметки в маске вместо Set и сортировки.
    const table = neighborTable(map);
    const mark = new Uint8Array(owner.length);
    for (const h of ownedHexes) {
      for (let side = 0; side < SIDES; side += 1) {
        const n = table[h * SIDES + side] as number;
        if (n >= 0) mark[n] = 1;
      }
    }
    candidates = [];
    for (let h = 0; h < mark.length; h += 1) if (mark[h] === 1) candidates.push(h);
  }
  const busy = new Set(view.units.map((u) => u.hex));
  const cities = new Set(view.cities.map((c) => c.hex));
  const out: HexId[] = [];
  for (const h of candidates) {
    if ((owner[h] ?? -1) >= 0) continue;
    if (map.terrain[h] === TERRAIN.water) continue;
    if (busy.has(h) || cities.has(h)) continue;
    out.push(h);
  }
  return out;
}

// Ничья земля без плана: нейтральный город при прогнозе «успех» — в приоритете (ближайший к
// отряду), иначе пустой ничий гекс у своей границы, ближайший к столице, затем к отряду: земля
// растёт кольцом у ядра, а не коридором за отрядом, уходящим из снабжения. Цели, куда уже идут
// свои отряды, не повторяются.
function expand(
  map: MapStatic,
  view: PlayerView,
  units: UnitView[],
  context: CommanderContext,
): Command[] {
  const claimed = new Set(
    view.units
      .filter((u) => u.owner === view.playerId && u.path.length > 0)
      .map((u) => u.path.at(-1) as HexId),
  );
  const capital = view.cities.find((c) => c.owner === view.playerId && c.isCapital)?.hex;
  const core = (h: HexId): number =>
    capital === undefined ? 0 : distance(hexOf(map, capital), hexOf(map, h));
  const empty = context.emptyNeutral;
  const table = neighborTable(map);
  const ownerOf = view.hexes.owner;
  // Гекс у своей границы: он сам свой или рядом свой сосед (расстояние до своей земли ≤ 1). Раньше для
  // каждого города считалось расстояние до всех своих гексов.
  const touchesOwn = (h: HexId): boolean => {
    if (ownerOf[h] === view.playerId) return true;
    for (let side = 0; side < SIDES; side += 1) {
      const n = table[h * SIDES + side] as number;
      if (n >= 0 && ownerOf[n] === view.playerId) return true;
    }
    return false;
  };
  const cities = view.cities.filter((c) => c.owner < 0 && c.defenders > 0).map((c) => c.hex);
  // Расстояние до своей земли считается один раз на город, а не на каждый отряд.
  const bordering = cities.filter(touchesOwn);
  const foes = view.units.filter((x) => warWith(view, x.owner));
  const out: Command[] = [];
  const dist = (a: HexId, b: HexId): number => distance(hexOf(map, a), hexOf(map, b));
  const rest: UnitView[] = [];
  for (const u of units.filter(idle)) {
    // Нейтральный город — только у своей границы: за далёким городом отряд тянул бы червяка
    // через ничью землю вместо целостного государства.
    let city: HexId | null = null;
    for (const h of bordering) {
      if (claimed.has(h) || forecastBattle(map, view, [u.id], h).outcome !== 'victory') continue;
      if (city === null || dist(u.hex, h) < dist(u.hex, city)) city = h;
    }
    if (city === null) {
      rest.push(u);
      continue;
    }
    claimed.add(city);
    out.push({ t: 'move', unitIds: [u.id], to: city });
  }
  // Ничья земля — ближайшему отряду (кольцом у ядра), отряд крупнее двух частей делится поровну
  // на соседние свободные гексы; вблизи врага не делится.
  const ownNeighbors = (h: HexId): number => {
    let count = 0;
    for (let side = 0; side < SIDES; side += 1) {
      const n = table[h * SIDES + side] as number;
      if (n >= 0 && ownerOf[n] === view.playerId) count += 1;
    }
    return count;
  };
  const cells = empty
    .filter((h) => !claimed.has(h))
    .map((h) => ({
      hex: h,
      // Кольцо у ядра и плотность: гексы с большим числом своих соседей занимаются раньше.
      cost: core(h) * RING_WEIGHT + (6 - ownNeighbors(h)) * EXPAND_COMPACT_WEIGHT,
      safe: foes.every((e) => dist(e.hex, h) > SWARM_SAFE),
    }));
  const orders = planExpansion(
    rest.map((u) => ({ id: u.id, hex: u.hex, soldiers: u.soldiers })),
    cells,
    dist,
    FRONT_SPLIT_MIN,
  );
  for (const order of orders) {
    for (const part of order.parts) {
      out.push({ t: 'split', unitId: order.unitId, soldiers: part.soldiers as Fp, to: part.hex });
    }
    if (order.main !== null) out.push({ t: 'move', unitIds: [order.unitId], to: order.main });
  }
  return out;
}

/**
 * Команды commander для армии armyId игрока снимка view (07-controls.md, «Автокомандование»).
 * @returns команды по порядку (их отдают с source 'auto')
 */
export function decide(
  map: MapStatic,
  view: PlayerView,
  armyId: number,
  lineDepth?: number,
  context?: CommanderContext,
  bot = false,
  mergeBelow: Fp = fp(25),
  mergeRadius = 3,
  profile: BotProfile = BOT_PROFILES.medium,
): Command[] {
  const army = view.armies.find((a) => a.id === armyId);
  if (!army) return [];
  const commanderContext = context ?? createCommanderContext(map, view);
  const out = [
    ...reinforce(view, armyId, bot),
    ...(bot ? mergeSmall(map, view, armyId, mergeBelow, mergeRadius) : []),
    ...seedExpansion(view, armyId, commanderContext),
  ];
  const units = armyUnits(view, armyId);
  const expansion =
    lineDepth !== undefined && commanderContext.emptyNeutral.length > 0 && view.armies.length > 1
      ? (view.armies.at(-1)?.id ?? null)
      : null;
  const piece = piecesOf(map, view, expansion, commanderContext).get(armyId);
  // Бот: свободные отряды бьют по вражескому городу, если прогноз боя — победа (commander-strike).
  // Пока рядом есть ничья земля и нет контакта с врагом, армия растит государство, а не воюет.
  // Окружённые отряды сначала прорываются к своей земле: остальные приказы их не касаются.
  const trapped = breakout(map, view, units);
  out.push(...trapped.commands);
  const struck =
    bot && (piece !== undefined || commanderContext.emptyNeutral.length === 0)
      ? strike(
          map,
          view,
          units.filter((u) => idle(u) && !trapped.ids.has(u.id)),
        )
      : [];
  const striking = new Set([
    ...trapped.ids,
    ...struck.flatMap((c) => (c.t === 'move' ? c.unitIds : [])),
  ]);
  out.push(...struck);
  const plan = view.plans.find((p) => p.armyId === armyId);
  if (piece) {
    if (plan?.kind !== 'front' || !plan.edges.some((e) => piece.edges.includes(e))) {
      out.push({ t: 'assignFront', armyId, edges: [...piece.edges] });
      return out;
    }
    out.push(
      ...retake(
        map,
        view,
        plan.lost,
        units.filter((u) => !striking.has(u.id)),
      ),
    );
    // Линию строим, когда её нет, и обновляем, когда идущая почти взята: наступление не встаёт.
    const finished =
      plan.offensive?.active === true &&
      ownedShare(view, plan.offensive.hexes) >= AXIS_DONE_PERCENT;
    if (bot) {
      out.push(...botWar(map, view, armyId, plan, piece, units, finished, lineDepth, profile));
      return out;
    }
    if ((plan.startWanted && !plan.offensive) || finished) {
      const lines = strikeAxes(map, view, plan.edges, piece.enemy, lineDepth);
      if (lines.length > 0) {
        out.push(
          { t: 'setOffensiveLine', armyId, edges: lines.flat(), lines },
          { t: 'startOffensive', armyId },
        );
      }
    }
    return out;
  }
  if (plan) out.push({ t: 'clearPlan', armyId });
  out.push(
    ...expand(
      map,
      view,
      units.filter((u) => !striking.has(u.id)),
      commanderContext,
    ),
  );
  return out;
}

// Война бота на своём участке фронта: наступает, когда сильнее врага у фронта, держится, когда слабее,
// и не стоит: нет линии, она выполнена или застряла — строит новую и сразу начинает.
function botWar(
  map: MapStatic,
  view: PlayerView,
  armyId: number,
  plan: Extract<PlanView, { kind: 'front' }>,
  piece: Piece,
  units: readonly UnitView[],
  finished: boolean,
  lineDepth: number | undefined,
  profile: BotProfile,
): Command[] {
  const active = plan.offensive?.active === true;
  const forces = frontForces(view, map.width, units, plan.edges, { map, hexes: view.hexes });
  if (stance(forces, active, profile) === 'hold') {
    return active ? [{ t: 'stopOffensive', armyId }] : [];
  }
  if (needsLine(plan, finished)) {
    // Линию, которую не удалось построить, повторно ищем не чаще раза в LINE_RETRY_TICKS на армию:
    // поиск по земле врага дорог, а команда была бы пустой каждый раз.
    if (plan.offensive === null && (view.tick + armyId) % LINE_RETRY_TICKS >= COMMANDER_TICKS)
      return [];
    const lines = strikeAxes(map, view, plan.edges, piece.enemy, lineDepth);
    if (lines.length === 0) return [];
    return [
      { t: 'setOffensiveLine', armyId, edges: lines.flat(), lines },
      { t: 'startOffensive', armyId },
    ];
  }
  return active ? [] : [{ t: 'startOffensive', armyId }];
}

// Доля гексов линии, уже взятых игроком, процентов.
function ownedShare(view: PlayerView, hexes: readonly HexId[]): number {
  if (hexes.length === 0) return 100;
  const own = hexes.filter((h) => view.hexes.owner[h] === view.playerId).length;
  return intDiv(own * 100, hexes.length);
}

// Широкий фронт бьёт несколькими осями: средние части равных кусков фронта, между ними — разрывы.
function strikeAxes(
  map: MapStatic,
  view: PlayerView,
  front: readonly EdgeId[],
  enemy: number,
  depth: number | undefined,
): EdgeId[][] {
  const count = Math.min(AXIS_MAX, intDiv(front.length, BOT_AXIS_EDGES));
  if (count < 2) return [commanderLine(map, view, front, enemy, depth)].filter((l) => l.length > 0);
  const size = intDiv(front.length, count);
  const margin = intDiv(size, 5);
  const lines: EdgeId[][] = [];
  for (let i = 0; i < count; i += 1) {
    const part = front.slice(i * size + margin, (i + 1) * size - margin);
    const line = commanderLine(map, view, part, enemy, depth);
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * Строит контекст решений commander для одного снимка игрока.
 * @returns пустые нейтральные гексы, доступные для экспансии
 */
export function createCommanderContext(
  map: MapStatic,
  view: PlayerView,
  ownedHexes?: readonly HexId[],
): CommanderContext {
  return {
    emptyNeutral: emptyNeutral(map, view, ownedHexes),
    enemyPieces: enemyPieces(
      { map, hexes: view.hexes },
      view.playerId,
      (player) => warWith(view, player),
      ownedHexes,
    ),
    assigned: new Map(),
  };
}
