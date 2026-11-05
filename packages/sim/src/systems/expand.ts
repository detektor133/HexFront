// Занятие ничьей земли направлением (07-controls.md, «Меню страны»): стоящие отряды армии идут
// занимать пустые ничьи гексы волной — от границы наружу, по одному гексу на отряд, чтобы земля
// росла сплошной, без червей. Приоритет волны выбирает ИИ: ничьи города, затем чужие столицы;
// клик, если он есть, лишь переносит приоритет в свою точку; соседний ничей город с гарнизоном — штурмом, если прогноз
// не «Поражение». Армия без плана: фронтом её отряды не управляет никто, кроме этой системы.
import {
  ASSAULT_MAX_UNITS,
  ASSAULT_REACH,
  EXPAND_COMPACT_WEIGHT,
  EXPAND_MOUNTAIN_PENALTY,
  EXPAND_PULL_RANGE,
  EXPAND_RADIUS_BASE,
  EXPAND_RADIUS_MAX,
  EXPAND_SOLDIERS_PER_HEX,
  EXPAND_STORM_GAP,
  MAX_UNITS_PER_HEX,
  SWARM_PART,
  SWARM_PARTS_PER_TICK,
  SWARM_SAFE,
} from '../balance.ts';
import { releaseDirection } from '../commands/release.ts';
import { executeUnitCommand, splitUnit, validateUnitCommand } from '../commands/unit.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { intDiv, type Fp } from '../math/int.ts';
import { forecastInState } from '../queries/forecast.ts';
import { findPath, ownUnitsAt } from '../queries/unit-path.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits, removeUnits } from '../state/unit-index.ts';

const NEUTRAL = -1;

function around(state: MatchState, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

// Есть ли свой гекс не дальше `gap` гексов (по кольцам соседей).
function nearOwn(state: MatchState, hex: HexId, owner: number, gap: number): boolean {
  let ring: HexId[] = [hex];
  const seen = new Set<HexId>(ring);
  for (let step = 0; step < gap; step += 1) {
    const next: HexId[] = [];
    for (const h of ring) {
      for (const n of around(state, h)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (state.hexes.owner[n] === owner) return true;
        next.push(n);
      }
    }
    ring = next;
  }
  return false;
}

// Свободные для занятия гексы: ничья суша у клика, примыкающая к своей земле, без отряда на ней.
function targets(
  state: MatchState,
  army: Army,
  focus: HexId[],
  radius: number,
  pull: boolean,
): HexId[] {
  const { width } = state.map;
  const marks = focus.map((h) => hexFromId(h, width));
  const away = (h: HexId): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(h, width))));
  // Город с гарнизоном — не цель занятия: его берёт только `storm`, когда сил хватает, иначе
  // одиночка шла бы в город пешком и гибла у стен. Город без гарнизона занимается как обычный гекс.
  const busy = new Set([
    ...allUnits(state).map((u) => u.hex),
    ...state.cities.filter((c) => c.defenders > 0).map((c) => c.hex),
  ]);
  const out: HexId[] = [];
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] !== NEUTRAL || state.map.terrain[h] === TERRAIN.water) continue;
    if (busy.has(h) || (Number.isFinite(radius) && away(h) > radius)) continue;
    if (!around(state, h).some((n) => state.hexes.owner[n] === army.owner)) continue;
    out.push(h);
  }
  // Территориальная целостность: раньше занимаются гексы с большим числом своих соседей (дыры и
  // бухты), цель волны тянет лишь вблизи — иначе земля вытягивается червём к далёкому городу.
  // Горы — в последнюю очередь: медленно, снабжение хуже, отряды там гибнут у стен городов.
  const reach = pull ? EXPAND_PULL_RANGE : Number.POSITIVE_INFINITY;
  const cost = (h: HexId): number => {
    const own = around(state, h).filter((n) => state.hexes.owner[n] === army.owner).length;
    return (
      (6 - own) * EXPAND_COMPACT_WEIGHT +
      Math.min(away(h), reach) +
      (state.map.terrain[h] === TERRAIN.mountains ? EXPAND_MOUNTAIN_PENALTY : 0)
    );
  };
  return out.sort((a, b) => cost(a) - cost(b) || a - b);
}

// Цели волны: ничьи города, а когда их нет — столицы других игроков.
function objectives(state: MatchState, army: Army): HexId[] {
  const free = state.cities.filter((c) => c.owner === NEUTRAL).map((c) => c.hex);
  if (free.length > 0) return free;
  return state.players
    .filter((p) => p.id !== army.owner && p.status === 'alive')
    .map((p) => state.cities.find((c) => c.id === p.capitalCityId)?.hex)
    .filter((h): h is HexId => h !== undefined);
}

function send(state: MatchState, unit: Unit, hex: HexId): boolean {
  const path = findPath(state, unit.hex, hex, unit.type, unit.owner);
  if (!path || path.length === 0) return false;
  unit.path = path;
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  unit.slot = -1;
  unit.order = 'move';
  return true;
}

// Рой: гексов для занятия больше, чем свободных отрядов, — крупные отряды отделяют части и
// отправляют их на свободные гексы, а не занимают землю по гексу за отряд. Вдали от чужих отрядов:
// мелкая часть рядом с врагом гибнет.
function swarm(state: MatchState, army: Army, free: Unit[], open: readonly HexId[]): void {
  const { width } = state.map;
  const foes = allUnits(state).filter((u) => u.owner !== army.owner);
  const safe = open.filter((h) =>
    foes.every((e) => distance(hexFromId(e.hex, width), hexFromId(h, width)) > SWARM_SAFE),
  );
  let missing = safe.length - free.length;
  const taken = new Set<HexId>();
  for (const unit of [...free].sort((a, b) => b.soldiers - a.soldiers || a.id - b.id)) {
    for (
      let n = 0;
      n < SWARM_PARTS_PER_TICK &&
      missing > 0 &&
      unit.soldiers >= 2 * SWARM_PART &&
      ownUnitsAt(state, unit.owner, unit.hex) < MAX_UNITS_PER_HEX;
      n += 1
    ) {
      const here = hexFromId(unit.hex, width);
      const hex = safe
        .filter((h) => !taken.has(h))
        .sort(
          (a, b) =>
            distance(here, hexFromId(a, width)) - distance(here, hexFromId(b, width)) || a - b,
        )[0];
      if (hex === undefined) return;
      const part = splitUnit(state, unit, SWARM_PART);
      if (send(state, part, hex)) {
        taken.add(hex);
        missing -= 1;
      } else {
        // Части некуда идти — она возвращается в отряд, а не остаётся лишней мелочью.
        unit.soldiers = (unit.soldiers + part.soldiers) as Fp;
        removeUnits(state, [part]);
        return;
      }
    }
  }
}

// Штурм ничьих городов: только когда сил хватит — по прогнозу боя «победа» либо одним отрядом, либо
// группой ближайших отрядов (до ASSAULT_MAX_UNITS). Отряд, которому город не по силам, не лезет в
// него поодиночке (и не гибнет, например, в горах у стен), а продолжает занимать землю.
function storm(
  state: MatchState,
  army: Army,
  free: readonly Unit[],
  idle: Set<number>,
  focus: readonly HexId[],
  radius: number,
): void {
  const { width } = state.map;
  const at = (h: HexId) => hexFromId(h, width);
  const underAssault = new Set(
    allUnits(state)
      .filter((u) => u.armyId === army.id)
      .map((u) => (u.order === 'attack' ? u.target : (u.path.at(-1) ?? -1))),
  );
  for (const city of state.cities) {
    if (city.owner !== NEUTRAL || city.defenders <= 0 || underAssault.has(city.hex)) continue;
    // Город далеко от своей земли стал бы анклавом: сначала земля дорастает до него.
    if (!nearOwn(state, city.hex, army.owner, EXPAND_STORM_GAP)) continue;
    if (
      focus.length > 0 &&
      Number.isFinite(radius) &&
      Math.min(...focus.map((m) => distance(at(city.hex), at(m)))) > radius
    ) {
      continue;
    }
    const pool = free
      .filter((u) => idle.has(u.id) && distance(at(u.hex), at(city.hex)) <= ASSAULT_REACH)
      .sort(
        (a, b) =>
          distance(at(a.hex), at(city.hex)) - distance(at(b.hex), at(city.hex)) || a.id - b.id,
      );
    const force: Unit[] = [];
    for (const unit of pool.slice(0, ASSAULT_MAX_UNITS)) {
      force.push(unit);
      if (forecastInState(state, force, city.hex).outcome !== 'victory') continue;
      const cmd = { t: 'attack', unitIds: force.map((u) => u.id), target: city.hex } as const;
      if (validateUnitCommand(state, army.owner, cmd).ok) {
        executeUnitCommand(state, army.owner, cmd);
        for (const u of force) idle.delete(u.id);
      }
      break;
    }
  }
}

/**
 * Один шаг занятия: простаивающие отряды армии получают ближайшие к клику свободные гексы;
 * когда занимать больше нечего, направление уходит в покой.
 */
export function expandNeutral(state: MatchState, army: Army): void {
  const dir = army.dir;
  if (!dir) return;
  const click = dir.hex;
  // Без клика ИИ идёт к ближайшей цели волны; с кликом — как раньше, в радиусе от него.
  const radius =
    click === undefined
      ? Number.POSITIVE_INFINITY
      : Math.min(
          EXPAND_RADIUS_MAX,
          EXPAND_RADIUS_BASE + intDiv(army.wanted ?? 0, EXPAND_SOLDIERS_PER_HEX),
        );
  const focus = click === undefined ? objectives(state, army) : [click];
  const free = allUnits(state)
    .filter(
      (u) =>
        u.armyId === army.id &&
        u.type !== 'artillery' &&
        u.order === 'idle' &&
        !u.inBattle &&
        u.org > 0,
    )
    .sort((a, b) => a.id - b.id);
  const free2 = new Set(free.map((u) => u.id));
  const { width } = state.map;
  const claimedHexes = (): Set<HexId> =>
    new Set(
      allUnits(state)
        .filter((u) => u.armyId === army.id && u.path.length > 0)
        .map((u) => u.path.at(-1) as HexId),
    );
  const before = claimedHexes();
  swarm(
    state,
    army,
    free,
    targets(state, army, focus, radius, click === undefined).filter((h) => !before.has(h)),
  );
  const moving = allUnits(state).some((u) => u.armyId === army.id && u.order !== 'idle');
  const claimed = claimedHexes();
  const open = targets(state, army, focus, radius, click === undefined).filter(
    (h) => !claimed.has(h),
  );
  storm(state, army, free, free2, focus, radius);
  for (const hex of open) {
    const at = hexFromId(hex, width);
    const unit = [...free2]
      .map((id) => free.find((u) => u.id === id))
      .filter((u): u is Unit => u !== undefined)
      .sort(
        (a, b) =>
          distance(hexFromId(a.hex, width), at) - distance(hexFromId(b.hex, width), at) ||
          a.id - b.id,
      )[0];
    if (!unit) break;
    if (send(state, unit, hex)) free2.delete(unit.id);
  }
  const finished = open.length === 0 && !moving && free2.size === free.length;
  // Занять больше нечего: армия расформировывается, отряды уходят в резерв — их возьмёт другое
  // направление, а закупка не гонит новобранцев в армию, которой делать нечего.
  if (finished) releaseDirection(state, army);
}
