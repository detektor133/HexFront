// Занятие ничьей земли направлением (07-controls.md, «Меню страны»): стоящие отряды армии идут
// занимать пустые ничьи гексы вокруг клика — от границы наружу, по одному гексу на отряд, чтобы
// земля росла сплошной, без червей; соседний ничей город с гарнизоном — штурмом, если прогноз
// не «Поражение». Армия без плана: фронтом её отряды не управляет никто, кроме этой системы.
import { EXPAND_RADIUS_BASE, EXPAND_RADIUS_MAX, EXPAND_SOLDIERS_PER_HEX } from '../balance.ts';
import { releaseDirection } from '../commands/release.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';
import { forecastInState } from '../queries/forecast.ts';
import { findPath } from '../queries/unit-path.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

const NEUTRAL = -1;

function around(state: MatchState, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

// Свободные для занятия гексы: ничья суша у клика, примыкающая к своей земле, без отряда на ней.
function targets(state: MatchState, army: Army, click: HexId, radius: number): HexId[] {
  const { width } = state.map;
  const at = hexFromId(click, width);
  const busy = new Set(allUnits(state).map((u) => u.hex));
  const out: HexId[] = [];
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] !== NEUTRAL || state.map.terrain[h] === TERRAIN.water) continue;
    if (distance(at, hexFromId(h, width)) > radius || busy.has(h)) continue;
    if (!around(state, h).some((n) => state.hexes.owner[n] === army.owner)) continue;
    out.push(h);
  }
  return out.sort(
    (a, b) => distance(at, hexFromId(a, width)) - distance(at, hexFromId(b, width)) || a - b,
  );
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

/**
 * Один шаг занятия: простаивающие отряды армии получают ближайшие к клику свободные гексы;
 * когда занимать больше нечего, направление уходит в покой.
 */
export function expandNeutral(state: MatchState, army: Army): void {
  const dir = army.dir;
  if (!dir || dir.hex === undefined) return;
  const radius = Math.min(
    EXPAND_RADIUS_MAX,
    EXPAND_RADIUS_BASE + intDiv(army.wanted ?? 0, EXPAND_SOLDIERS_PER_HEX),
  );
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
  const moving = allUnits(state).some((u) => u.armyId === army.id && u.order !== 'idle');
  const free2 = new Set(free.map((u) => u.id));
  const { width } = state.map;
  const claimed = new Set(
    allUnits(state)
      .filter((u) => u.armyId === army.id && u.path.length > 0)
      .map((u) => u.path.at(-1) as HexId),
  );
  const open = targets(state, army, dir.hex, radius).filter((h) => !claimed.has(h));
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
      distance(hexFromId(city.hex, width), hexFromId(dir.hex, width)) > radius
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
