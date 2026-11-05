// Лимит армии — заказанная численность направления (`wanted`): сколько солдат держать на цели.
// Меняется на карточке армии и в окне соседа одной и той же командой направления.
import { FP, type ArmyView, type Command, type PlayerView } from '@hexfront/sim';

/** Шаг кнопок −/+ лимита, солдат. */
export const LIMIT_STEP = 10;

/**
 * Предел лимита: солдаты в отрядах плюс половина населения — недостающих ИИ закупит и подведёт.
 * @returns солдат, не меньше 1
 */
export function maxArmySoldiers(view: PlayerView): number {
  const total = view.units
    .filter((unit) => unit.owner === view.playerId)
    .reduce((sum, unit) => sum + unit.soldiers, 0);
  return Math.max(1, Math.floor((total + view.me.popTotal / 2) / FP));
}

/** Доля предела, округлённая до целых солдат. */
export function presetAmount(max: number, share: number): number {
  return Math.max(1, Math.round(max * share));
}

/** Ограничивает значение лимита пределом 0..max. */
export function clampLimit(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
}

/**
 * Команда нового лимита для армии с направлением: режим (держать или наступать) сохраняется.
 * @returns null — у армии нет направления, лимита нет
 */
export function limitCommand(army: ArmyView, soldiers: number): Command | null {
  const dir = army.dir;
  if (!dir) return null;
  return dir.mode === 'attack'
    ? { t: 'launchOffensive', target: dir.target, soldiers }
    : { t: 'holdBorder', target: dir.target, soldiers };
}
