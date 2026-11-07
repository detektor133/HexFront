// Морские высадки ботов (09-bots.md): бот воюет и за морем. Раз в SEA_THINK_TICKS армия из порта
// отправляется на ближайший берег врага, до которого не дотянуться сушей: на сам берег, а не на
// свою землю. Плата — как у игрока, тратится не больше половины золота.
import type { BotTickContext } from './context.ts';
import { sailCost } from '../commands/sail.ts';
import type { Command } from '../commands/types.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { FP } from '../math/int.ts';
import { seaTargets } from '../queries/sea-route.ts';
import { isPortOf } from '../state/port.ts';
import { atWar } from '../state/relations.ts';
import type { MatchState, Unit } from '../state/types.ts';

/** Как часто бот думает о высадке, тиков. */
const SEA_THINK_TICKS = 600;
/** Меньше стольких солдат в порту на высадку не идут, солдат. */
const SEA_MIN_SOLDIERS = 300;
/** Берег ближе стольких гексов к своей земле — достижим сушей, высадка не нужна. */
const LAND_REACH = 6;

/**
 * Команды вторжения бота me на этот тик.
 * @returns не больше одной команды invade
 */
export function seaCommands(state: MatchState, me: number, context: BotTickContext): Command[] {
  if (state.tick % SEA_THINK_TICKS !== (me * 13) % SEA_THINK_TICKS) return [];
  const g = { map: state.map, hexes: state.hexes, cities: state.cities };
  const owned = context.ownedHexes[me] ?? [];
  const ownedCoords = owned.map((h) => hexFromId(h, state.map.width));
  const player = state.players[me];
  if (!player) return [];
  for (const port of owned) {
    if (!isPortOf(g, me, port)) continue;
    // Армия, большая часть которой стоит в этом порту и готова.
    const byArmy = new Map<number, Unit[]>();
    for (const u of context.unitsByHex[port] ?? []) {
      if (u.owner !== me || u.armyId === null || u.sea || u.inBattle || u.order !== 'idle')
        continue;
      byArmy.set(u.armyId, [...(byArmy.get(u.armyId) ?? []), u]);
    }
    for (const [armyId, units] of [...byArmy].sort((a, b) => a[0] - b[0])) {
      const soldiers = units.reduce((s, u) => s + u.soldiers, 0);
      if (soldiers < SEA_MIN_SOLDIERS * FP) continue;
      let best: { hex: number; seaHexes: number } | null = null;
      for (const [hex, seaHexes] of seaTargets(state.map, port)) {
        const owner = state.hexes.owner[hex] ?? -1;
        if (owner < 0 || owner === me || !atWar(state, me, owner)) continue;
        const at = hexFromId(hex, state.map.width);
        if (ownedCoords.some((c) => distance(c, at) <= LAND_REACH)) continue;
        if (!best || seaHexes < best.seaHexes || (seaHexes === best.seaHexes && hex < best.hex)) {
          best = { hex, seaHexes };
        }
      }
      if (!best) continue;
      const cost = sailCost(g, me, units, best.hex, best.seaHexes);
      if (cost * 2 > player.gold) continue;
      return [{ t: 'invade', armyId, from: port, to: best.hex }];
    }
  }
  return [];
}
