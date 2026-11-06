// Прорыв из окружения (gdd/07-controls.md, «Автокомандование»): отряд без пути снабжения рядом с
// врагом не ждёт гибели в котле, а бьёт в сторону ближайшей своей связной земли. Чистая функция
// снимка игрока — без случайности и мутаций.
import { warWith } from './war.ts';
import type { Command } from '../commands/types.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import type { PlayerView } from '../queries/player-view.ts';
import type { UnitView } from '../queries/unit-view.ts';

/** Враг ближе стольких гексов — отряд без снабжения считается окружённым, а не ушедшим в ничью землю. */
const FOE_NEAR = 2;

const around = (map: MapStatic, h: HexId): HexId[] =>
  neighbors(hexFromId(h, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width));

// Своя земля, связная со столицей (или с любым своим городом, если столицы нет).
function connectedOwn(map: MapStatic, view: PlayerView): Set<HexId> {
  const own = (h: HexId): boolean => view.hexes.owner[h] === view.playerId;
  const cities = view.cities.filter((c) => c.owner === view.playerId);
  const roots = cities.some((c) => c.isCapital) ? cities.filter((c) => c.isCapital) : cities;
  const seen = new Set<HexId>();
  const queue: HexId[] = [];
  for (const c of roots) {
    if (own(c.hex) && !seen.has(c.hex)) {
      seen.add(c.hex);
      queue.push(c.hex);
    }
  }
  for (let i = 0; i < queue.length; i += 1) {
    for (const n of around(map, queue[i] as HexId)) {
      if (seen.has(n) || !own(n) || map.terrain[n] === TERRAIN.water) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * Прорыв окружённых отрядов: каждая группа на одном гексе шагает в соседний гекс, ближайший к
 * связной своей земле (вражеский — атакой, иной — ходом). Отряды в бою и в переходе не трогаются.
 * @returns команды и id отрядов, которым отдан приказ прорыва
 */
export function breakout(
  map: MapStatic,
  view: PlayerView,
  units: readonly UnitView[],
): { readonly commands: Command[]; readonly ids: Set<number> } {
  const commands: Command[] = [];
  const ids = new Set<number>();
  const trapped = units.filter(
    (u) =>
      u.encircled === true &&
      u.type !== 'artillery' &&
      u.order !== 'retreat' &&
      u.moveTotal === 0 &&
      u.path.length === 0,
  );
  if (trapped.length === 0) return { commands, ids };
  const safe = connectedOwn(map, view);
  if (safe.size === 0) return { commands, ids };
  const at = (h: HexId) => hexFromId(h, map.width);
  const toSafe = (h: HexId): number => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const s of safe) best = Math.min(best, distance(at(h), at(s)));
    return best;
  };
  const foes = view.units.filter((x) => warWith(view, x.owner));
  const enemyLand = (h: HexId): boolean => {
    const o = view.hexes.owner[h] ?? -1;
    return o >= 0 && o !== view.playerId && warWith(view, o);
  };
  const hexes = [...new Set(trapped.map((u) => u.hex))].sort((a, b) => a - b);
  for (const hex of hexes) {
    if (safe.has(hex)) continue;
    const nearFoe =
      foes.some((f) => distance(at(f.hex), at(hex)) <= FOE_NEAR) ||
      around(map, hex).some(enemyLand);
    if (!nearFoe) continue;
    const here = toSafe(hex);
    const step = around(map, hex)
      .filter((n) => map.terrain[n] !== TERRAIN.water)
      .map((n) => ({ n, d: toSafe(n) }))
      .filter(({ d }) => d < here)
      .sort((a, b) => a.d - b.d || a.n - b.n)[0];
    if (!step) continue;
    const group = trapped.filter((u) => u.hex === hex).map((u) => u.id);
    const city = view.cities.find((c) => c.hex === step.n);
    const hostile =
      foes.some((f) => f.hex === step.n) ||
      (city !== undefined && city.owner !== view.playerId && city.defenders > 0);
    commands.push(
      hostile
        ? { t: 'attack', unitIds: group, target: step.n }
        : { t: 'move', unitIds: group, to: step.n },
    );
    for (const id of group) ids.add(id);
  }
  return { commands, ids };
}
