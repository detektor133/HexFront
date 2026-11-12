// Армии под фронты (gdd/09-bots.md, «Армии под фронты»): у бота столько армий, сколько кусков границы
// с врагами ему надо держать. Когда кусков больше свободных армий, самая крупная армия делится
// пополам (`splitArmy`), и новая получает свой участок фронта у commander. Армия экспансии, пока
// есть ничья земля, под фронты не берётся.
import type { BotProfile } from '../balance.ts';
import { BOT_SPLIT_MIN_SOLDIERS } from '../balance.ts';
import type { Command } from '../commands/types.ts';
import type { PlayerView } from '../queries/player-view.ts';

/**
 * Команда деления армии, если фронтов больше, чем армий для них.
 * @param pieces сколько кусков границы с врагами надо держать
 * @param expansionReserved последняя армия занята экспансией и под фронт не идёт
 * @returns не больше одной команды `splitArmy`
 */
export function frontSplit(
  view: PlayerView,
  pieces: number,
  expansionReserved: boolean,
  profile: BotProfile,
): Command[] {
  const auto = view.armies.filter((a) => a.auto);
  const reserved = expansionReserved ? (view.armies.at(-1)?.id ?? -1) : -1;
  const available = auto.filter((a) => a.id !== reserved);
  if (pieces <= available.length || view.armies.length >= profile.maxArmies) return [];
  // Новая армия ещё не получила участок: ждём, пока commander её пристроит.
  const planned = new Set(view.plans.map((p) => p.armyId));
  if (available.some((a) => !planned.has(a.id))) return [];
  const size = new Map<number, { soldiers: number; units: number }>();
  for (const u of view.units) {
    if (u.owner !== view.playerId || u.armyId === null) continue;
    const row = size.get(u.armyId) ?? { soldiers: 0, units: 0 };
    size.set(u.armyId, { soldiers: row.soldiers + u.soldiers, units: row.units + 1 });
  }
  const biggest = available
    .map((a) => ({ id: a.id, ...(size.get(a.id) ?? { soldiers: 0, units: 0 }) }))
    .sort((x, y) => y.soldiers - x.soldiers || x.id - y.id)[0];
  if (!biggest || biggest.units < 2 || biggest.soldiers < BOT_SPLIT_MIN_SOLDIERS) return [];
  return [{ t: 'splitArmy', armyId: biggest.id }];
}
