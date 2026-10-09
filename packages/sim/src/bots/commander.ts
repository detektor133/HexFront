// Автокомандование армии (CR-006; gdd/07-controls.md, «Автокомандование»): чистая функция снимка
// игрока — без случайности и мутаций, стабильный порядок команд. Война — фронт на непрерывный кусок
// границы с врагом (не больше одной армии на кусок), свои потерянные гексы у фронта — отбить; ничья
// земля — занять без плана, нейтральный город — штурм при прогнозе «успех», в приоритете; ▶ без
// линии — построить линию; лишние отряды резерва — в самую слабую армию. Сам на игроков не наступает.
import { commanderLine } from './commander-line.ts';
import { MAX_UNITS_PER_HEX } from '../balance.ts';
import type { Command } from '../commands/types.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { fp, type Fp } from '../math/int.ts';
import { forecastBattle } from '../queries/forecast.ts';
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

/** Множитель ключа цели экспансии: больше любого расстояния на карте в гексах. */
const LAND_KEY = 1 << 16;

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

const hexOf = (map: MapStatic, h: HexId) => hexFromId(h, map.width);

// Куски границы с каждым врагом (до дипломатии все игроки — враги), по первой грани.
function enemyPieces(g: Ground, me: number, ownedHexes?: readonly HexId[]): Piece[] {
  const out: Piece[] = [];
  const seen = new Set<EdgeId>();
  const borders =
    ownedHexes === undefined
      ? borderEdges(g, me)
      : ownedHexes.flatMap((h) =>
          Array.from({ length: 6 }, (_, direction) => edgeOf(h, direction)).filter((e) =>
            isBorderEdge(g, me, e),
          ),
        );
  for (const e of borders) {
    const enemy = g.hexes.owner[edgeOther(g, e)] ?? -1;
    if (enemy < 0 || seen.has(e)) continue;
    const edges = borderSegmentEdges(g, me, enemy, e);
    for (const x of edges) seen.add(x);
    if (edges.length > 0) out.push({ enemy, edges });
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
    if ((view.hexes.owner[h] ?? -1) < 0 || view.hexes.owner[h] === view.playerId) continue;
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
    candidates = [
      ...new Set(
        ownedHexes.flatMap((h) =>
          neighbors(hexOf(map, h))
            .filter((n) => inBounds(n, map.width, map.height))
            .map((n) => hexId(n, map.width)),
        ),
      ),
    ].sort((a, b) => a - b);
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
  const cities = view.cities.filter((c) => c.owner < 0 && c.defenders > 0).map((c) => c.hex);
  const out: Command[] = [];
  for (const u of units.filter(idle)) {
    const at = hexOf(map, u.hex);
    // Лучшая цель по ключу (меньше — лучше), при равенстве — меньший HexId.
    const nearest = (hexes: readonly HexId[], key: (h: HexId) => number): HexId | null => {
      let best: HexId | null = null;
      let bestK = Number.MAX_SAFE_INTEGER;
      for (const h of hexes) {
        const k = key(h);
        if (!claimed.has(h) && (k < bestK || (k === bestK && best !== null && h < best))) {
          best = h;
          bestK = k;
        }
      }
      return best;
    };
    const fromUnit = (h: HexId): number => distance(at, hexOf(map, h));
    // Расстояния на карте меньше LAND_KEY, поэтому ключ — «сначала к столице, потом к отряду».
    const fromCore = (h: HexId): number => core(h) * LAND_KEY + fromUnit(h);
    const winnable = cities.filter(
      (h) => forecastBattle(map, view, [u.id], h).outcome === 'victory',
    );
    const target = nearest(winnable, fromUnit) ?? nearest(empty, fromCore);
    if (target === null) continue;
    claimed.add(target);
    out.push({ t: 'move', unitIds: [u.id], to: target });
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
  const plan = view.plans.find((p) => p.armyId === armyId);
  if (piece) {
    if (plan?.kind !== 'front' || !plan.edges.some((e) => piece.edges.includes(e))) {
      out.push({ t: 'assignFront', armyId, edges: [...piece.edges] });
      return out;
    }
    out.push(...retake(map, view, plan.lost, units));
    if (plan.startWanted && !plan.offensive) {
      const line = commanderLine(map, view, plan.edges, piece.enemy, lineDepth);
      if (line.length > 0) {
        out.push({ t: 'setOffensiveLine', armyId, edges: line }, { t: 'startOffensive', armyId });
      }
    }
    return out;
  }
  if (plan) out.push({ t: 'clearPlan', armyId });
  out.push(...expand(map, view, units, commanderContext));
  return out;
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
    enemyPieces: enemyPieces({ map, hexes: view.hexes }, view.playerId, ownedHexes),
    assigned: new Map(),
  };
}
