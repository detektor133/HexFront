// Запрет «обратного хода»: автоматика (расстановка фронта, слияние мелочи, наступление) не отправляет
// отряд обратно в гекс, который он только что покинул. Иначе пересмотр мест, слияние и шаг
// наступления тянули бы отряд то вперёд, то назад — «перебежки» без смысла. Приказ игрока, отступление
// и бой запрет не касается.
import { RETURN_LOCK_TICKS } from '../balance.ts';
import type { MatchState, Unit } from './types.ts';
import type { HexId } from '../math/hex.ts';

/**
 * Отряд только что вышел из этого гекса: автоматике возвращать его туда рано.
 * @returns true, пока с ухода из гекса не прошло RETURN_LOCK_TICKS тиков
 */
export function recentlyLeft(state: MatchState, unit: Unit, hex: HexId): boolean {
  return (
    unit.came === hex &&
    unit.cameTick !== undefined &&
    state.tick - unit.cameTick < RETURN_LOCK_TICKS
  );
}
