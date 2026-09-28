// Автокомандование армии (CR-006; gdd/07-controls.md, «Автокомандование»): чистая функция снимка
// игрока — без случайности и мутаций, стабильный порядок команд. Война — фронт на непрерывный кусок
// границы с врагом (не больше одной армии на кусок), свои потерянные гексы у фронта — отбить; ничья
// земля — занять без плана, нейтральный город — штурм при прогнозе «успех», в приоритете; ▶ без
// линии — построить линию; лишние отряды резерва — в самую слабую армию. Сам на игроков не наступает.
import { commanderLine } from './commander-line.ts';
import type { Command } from '../commands/types.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { forecastBattle } from '../queries/forecast.ts';
import type { PlayerView } from '../queries/player-view.ts';
import type { UnitView } from '../queries/unit-view.ts';
import {
  borderEdges,
  borderSegmentEdges,
  edgeHex,
  edgeOther,
  type EdgeId,
} from '../state/edges.ts';

type Ground = { map: MapStatic; hexes: { owner: Int16Array } };

/** Непрерывный кусок своей границы с врагом. */
interface Piece {
  readonly enemy: number;
  readonly edges: readonly EdgeId[];
}

const hexOf = (map: MapStatic, h: HexId) => hexFromId(h, map.width);

// Куски границы с каждым врагом (до дипломатии все игроки — враги), по первой грани.
function enemyPieces(g: Ground, me: number): Piece[] {
  const out: Piece[] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(g, me)) {
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
function assignPieces(map: MapStatic, view: PlayerView, pieces: readonly Piece[]) {
  const auto = view.armies.filter((a) => a.auto).map((a) => a.id);
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
function reinforce(view: PlayerView, armyId: number): Command[] {
  const auto = view.armies.filter((a) => a.auto);
  if (auto[0]?.id !== armyId) return [];
  const soldiers = new Map(auto.map((a) => [a.id, 0]));
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId !== null && soldiers.has(u.armyId)) {
      soldiers.set(u.armyId, (soldiers.get(u.armyId) ?? 0) + u.soldiers);
    }
  }
  const out: Command[] = [];
  const reserve = view.units.filter(
    (u) => u.owner === view.playerId && u.armyId === null && u.order !== 'retreat',
  );
  for (const u of reserve) {
    const [weakest] = [...soldiers].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (!weakest) break;
    out.push({ t: 'assignUnits', unitIds: [u.id], armyId: weakest[0] });
    soldiers.set(weakest[0], weakest[1] + u.soldiers);
  }
  return out;
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
function emptyNeutral(map: MapStatic, view: PlayerView): HexId[] {
  const out: HexId[] = [];
  const busy = new Set(view.units.map((u) => u.hex));
  const cities = new Set(view.cities.map((c) => c.hex));
  view.hexes.owner.forEach((o, h) => {
    if (o >= 0 || map.terrain[h] === TERRAIN.water || busy.has(h) || cities.has(h)) return;
    const near = neighbors(hexOf(map, h)).some(
      (n) =>
        inBounds(n, map.width, map.height) &&
        view.hexes.owner[hexId(n, map.width)] === view.playerId,
    );
    if (near) out.push(h);
  });
  return out;
}

// Ничья земля без плана: нейтральный город при прогнозе «успех» — в приоритете, иначе ближайший
// пустой ничий гекс у своей границы; цели, куда уже идут свои отряды, не повторяются.
function expand(map: MapStatic, view: PlayerView, units: UnitView[]): Command[] {
  const claimed = new Set(
    view.units
      .filter((u) => u.owner === view.playerId && u.path.length > 0)
      .map((u) => u.path.at(-1) as HexId),
  );
  const empty = emptyNeutral(map, view);
  const cities = view.cities.filter((c) => c.owner < 0 && c.defenders > 0).map((c) => c.hex);
  const out: Command[] = [];
  for (const u of units.filter(idle)) {
    const at = hexOf(map, u.hex);
    const nearest = (hexes: readonly HexId[]): HexId | null => {
      let best: HexId | null = null;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const h of hexes) {
        const d = distance(at, hexOf(map, h));
        if (!claimed.has(h) && (d < bestD || (d === bestD && best !== null && h < best))) {
          best = h;
          bestD = d;
        }
      }
      return best;
    };
    const winnable = cities.filter(
      (h) => forecastBattle(map, view, [u.id], h).outcome === 'victory',
    );
    const target = nearest(winnable) ?? nearest(empty);
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
export function decide(map: MapStatic, view: PlayerView, armyId: number): Command[] {
  const army = view.armies.find((a) => a.id === armyId);
  if (!army) return [];
  const out = reinforce(view, armyId);
  const units = armyUnits(view, armyId);
  const g = { map, hexes: view.hexes };
  const piece = assignPieces(map, view, enemyPieces(g, view.playerId)).get(armyId);
  const plan = view.plans.find((p) => p.armyId === armyId);
  if (piece) {
    if (plan?.kind !== 'front' || !plan.edges.some((e) => piece.edges.includes(e))) {
      out.push({ t: 'assignFront', armyId, edges: [...piece.edges] });
      return out;
    }
    out.push(...retake(map, view, plan.lost, units));
    if (plan.startWanted && !plan.offensive) {
      const line = commanderLine(map, view, plan.edges, piece.enemy);
      if (line.length > 0) {
        out.push({ t: 'setOffensiveLine', armyId, edges: line }, { t: 'startOffensive', armyId });
      }
    }
    return out;
  }
  if (plan) out.push({ t: 'clearPlan', armyId });
  out.push(...expand(map, view, units));
  return out;
}
