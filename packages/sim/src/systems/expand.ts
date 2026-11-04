// Занятие ничьей земли направлением (07-controls.md, «Меню страны»): стоящие отряды армии идут
// занимать пустые ничьи гексы волной — от границы наружу, по одному гексу на отряд, чтобы земля
// росла сплошной, без червей. Приоритет волны выбирает ИИ: ничьи города, затем чужие столицы;
// клик, если он есть, лишь переносит приоритет в свою точку; соседний ничей город с гарнизоном — штурмом, если прогноз
// не «Поражение». Армия без плана: фронтом её отряды не управляет никто, кроме этой системы.
import {
  EXPAND_RADIUS_BASE,
  EXPAND_RADIUS_MAX,
  EXPAND_SOLDIERS_PER_HEX,
  MAX_UNITS_PER_HEX,
  SWARM_PART,
  SWARM_PARTS_PER_TICK,
  SWARM_SAFE,
} from '../balance.ts';
import { releaseDirection } from '../commands/release.ts';
import { splitUnit } from '../commands/unit.ts';
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

// Свободные для занятия гексы: ничья суша у клика, примыкающая к своей земле, без отряда на ней.
function targets(state: MatchState, army: Army, focus: HexId[], radius: number): HexId[] {
  const { width } = state.map;
  const marks = focus.map((h) => hexFromId(h, width));
  const away = (h: HexId): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(h, width))));
  const busy = new Set(allUnits(state).map((u) => u.hex));
  const out: HexId[] = [];
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] !== NEUTRAL || state.map.terrain[h] === TERRAIN.water) continue;
    if (busy.has(h) || (Number.isFinite(radius) && away(h) > radius)) continue;
    if (!around(state, h).some((n) => state.hexes.owner[n] === army.owner)) continue;
    out.push(h);
  }
  return out.sort((a, b) => away(a) - away(b) || a - b);
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
    targets(state, army, focus, radius).filter((h) => !before.has(h)),
  );
  const moving = allUnits(state).some((u) => u.armyId === army.id && u.order !== 'idle');
  const claimed = claimedHexes();
  const open = targets(state, army, focus, radius).filter((h) => !claimed.has(h));
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
  // Ничей город у занятой земли берут штурмом, когда рядом стоит отряд и прогноз не «Поражение».
  for (const city of state.cities) {
    if (
      city.owner !== NEUTRAL ||
      (focus.length > 0 &&
        Number.isFinite(radius) &&
        Math.min(...focus.map((m) => distance(hexFromId(city.hex, width), hexFromId(m, width)))) >
          radius)
    ) {
      continue;
    }
    const near = around(state, city.hex);
    const unit = free
      .filter((u) => free2.has(u.id) && near.includes(u.hex))
      .find((u) => forecastInState(state, [u], city.hex).outcome !== 'defeat');
    if (!unit) continue;
    unit.order = 'attack';
    unit.target = city.hex;
    unit.slot = -1;
    free2.delete(unit.id);
  }
  const finished = open.length === 0 && !moving && free2.size === free.length;
  // Занять больше нечего: армия расформировывается, отряды уходят в резерв — их возьмёт другое
  // направление, а закупка не гонит новобранцев в армию, которой делать нечего.
  if (finished) releaseDirection(state, army);
}
