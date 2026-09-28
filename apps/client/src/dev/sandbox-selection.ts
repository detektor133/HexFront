// Выбор и приказы в песочнице как в HoI4 (07-controls.md): тап/ЛКМ только выбирает и снимает
// выбор, приказ — удержанием или ПКМ: «идти» на свободный гекс, «атаковать» вражеский — сразу, без
// подтверждения (прогноз — только подсказка).
import type { Command, PlayerView, UnitView } from '@hexfront/sim';

/** Выбранный гекс, свои отряды и цель приказа, пока палец держит (удержание). */
export interface Picked {
  readonly hex: number | null;
  readonly units: readonly number[];
  readonly target: number | null;
}

export const NOTHING_PICKED: Picked = { hex: null, units: [], target: null };

/** Свои отряды в гексе (не отступающие — им приказы не отдаются). */
export function ownUnitsAt(view: PlayerView, hex: number): UnitView[] {
  return view.units.filter(
    (u) => u.hex === hex && u.owner === view.playerId && u.order !== 'retreat',
  );
}

/** Гекс занят врагом: чужие отряды или чужой город с обороной (как isHostileHex в sim). */
export function isHostile(view: PlayerView, hex: number): boolean {
  if (view.units.some((u) => u.hex === hex && u.owner !== view.playerId)) return true;
  const city = view.cities.find((c) => c.hex === hex);
  return city !== undefined && city.owner !== view.playerId && city.defenders > 0;
}

function pickedUnits(view: PlayerView, picked: Picked): UnitView[] {
  return picked.units
    .map((id) => view.units.find((u) => u.id === id && u.owner === view.playerId))
    .filter((u): u is UnitView => u !== undefined);
}

/**
 * Тап (выбор), подсвечивается что-то одно (07-controls.md, «Что выбрано»): гекс со своими
 * отрядами выбирает отряды — гекс не подсвечен; повторный тап по тем же отрядам или тап по
 * другому гексу — выбран гекс, отряды не выбраны.
 */
export function selectHex(view: PlayerView, picked: Picked, hex: number): Picked {
  const units = ownUnitsAt(view, hex).map((u) => u.id);
  const same = units.length > 0 && units.every((id) => picked.units.includes(id));
  if (units.length > 0 && !same) return { hex: null, units, target: null };
  return { hex, units: [], target: null };
}

/** Армии выбранных отрядов: выбранная целиком и затронутые частично. */
export interface ArmySelection {
  readonly whole: number | null;
  readonly partial: readonly number[];
}

/**
 * Выбраны вручную все отряды одной армии — армия выбрана целиком; часть отрядов армии — армия
 * затронута частично (тонкая рамка карточки, инструменты планов недоступны).
 */
export function armySelection(view: PlayerView, picked: readonly number[]): ArmySelection {
  const mine = view.units.filter((u) => u.owner === view.playerId && u.armyId !== null);
  const touched = [
    ...new Set(mine.filter((u) => picked.includes(u.id)).map((u) => u.armyId as number)),
  ].sort((a, b) => a - b);
  const whole = touched.filter((a) =>
    mine.filter((u) => u.armyId === a).every((u) => picked.includes(u.id)),
  );
  // Армия выбирается сама, только если выбрана ровно она — целиком и без чужих отрядов.
  const only = whole.length === 1 && touched.length === 1 ? (whole[0] as number) : null;
  const outside = picked.some((id) => !mine.some((u) => u.id === id && u.armyId === only));
  const full = only !== null && !outside ? only : null;
  return { whole: full, partial: touched.filter((a) => a !== full) };
}

/**
 * Приказ (отпустили удержание, ПКМ) выбранным отрядам: свободный гекс — «идти», вражеский —
 * «атаковать» сразу (артиллерия в атаку не идёт).
 * @returns новый выбор и команда (или null)
 */
export function orderHex(
  view: PlayerView,
  picked: Picked,
  hex: number,
): { readonly picked: Picked; readonly cmd: Command | null } {
  const mine = pickedUnits(view, picked);
  if (mine.length === 0) return { picked: selectHex(view, picked, hex), cmd: null };
  const done = { ...picked, target: null };
  if (isHostile(view, hex)) {
    const attackers = mine.filter((u) => u.type !== 'artillery');
    if (attackers.length === 0) return { picked: done, cmd: null };
    return { picked: done, cmd: { t: 'attack', unitIds: attackers.map((u) => u.id), target: hex } };
  }
  if (mine.every((u) => u.hex === hex)) return { picked: done, cmd: null };
  return { picked: done, cmd: { t: 'move', unitIds: mine.map((u) => u.id), to: hex } };
}

/** Свои выбранные отряды (есть в снимке), для прогноза и отмены приказа удержанием. */
export function pickedOwn(view: PlayerView, picked: Picked): UnitView[] {
  return pickedUnits(view, picked);
}
