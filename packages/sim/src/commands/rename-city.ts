// Переименование своего города (07-controls.md, «Названия городов»).
import { OK, rejected, type Validation } from './types.ts';
import { CITY_NAME_MAX } from '../map/city-names.ts';
import type { MatchState } from '../state/types.ts';

/** Название допустимо: непустое после обрезки пробелов и не длиннее CITY_NAME_MAX. */
export function validCityName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= CITY_NAME_MAX;
}

/**
 * Проверяет переименование: город существует и принадлежит игроку, название допустимо.
 * @returns OK или отказ с причиной
 */
export function validateRenameCity(
  state: MatchState,
  playerId: number,
  cmd: { readonly cityId: number; readonly name: string },
): Validation {
  const city = state.cities.find((c) => c.id === cmd.cityId);
  if (!city) return rejected('unknownCity');
  if (city.owner !== playerId) return rejected('notOwnCity');
  return validCityName(cmd.name) ? OK : rejected('badName');
}

/** Применяет переименование после успешной проверки. */
export function executeRenameCity(
  state: MatchState,
  cmd: { readonly cityId: number; readonly name: string },
): void {
  const city = state.cities.find((c) => c.id === cmd.cityId);
  if (city) city.name = cmd.name.trim();
}
