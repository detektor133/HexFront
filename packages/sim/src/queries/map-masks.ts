// Маски для режимов карты: где можно строить выбранное здание и как снабжён каждый гекс.
import { checkConstruction } from '../commands/construction.ts';
import type { Command } from '../commands/types.ts';
import type { HexId } from '../math/hex.ts';
import type { MatchState } from '../state/types.ts';

export type BuildMaskKind = 'city' | 'fort' | 'depot' | 'improve';

/** Значения маски стройки: нельзя / можно / по правилам можно, но не хватает золота. */
export const BUILD_NO = 0;
export const BUILD_OK = 1;
export const BUILD_NO_GOLD = 2;

type BuildCommand = Extract<Command, { t: 'foundCity' | 'upgradeCity' | 'improve' | 'build' }>;

function commandFor(
  cityIds: ReadonlyMap<HexId, number>,
  kind: BuildMaskKind,
  hex: HexId,
): BuildCommand {
  switch (kind) {
    case 'city': {
      // На гексе города инструмент «город» улучшает его, на пустом — основывает новый.
      const cityId = cityIds.get(hex);
      return cityId === undefined ? { t: 'foundCity', hex } : { t: 'upgradeCity', cityId };
    }
    case 'improve':
      return { t: 'improve', hex };
    default:
      return { t: 'build', hex, kind };
  }
}

/**
 * Где игрок может построить здание: та же проверка, что у команды, по всем своим гексам.
 * @returns байт на гекс: BUILD_NO / BUILD_OK / BUILD_NO_GOLD
 */
export function buildMask(state: MatchState, playerId: number, kind: BuildMaskKind): Uint8Array {
  const out = new Uint8Array(state.hexes.owner.length);
  const cityIds = new Map(state.cities.map((c) => [c.hex, c.id] as const));
  state.hexes.owner.forEach((owner, hex) => {
    if (owner !== playerId) return;
    const check = checkConstruction(state, playerId, commandFor(cityIds, kind, hex));
    if (check.ok) out[hex] = BUILD_OK;
    else if (check.reason === 'notEnoughGold') out[hex] = BUILD_NO_GOLD;
  });
  return out;
}
