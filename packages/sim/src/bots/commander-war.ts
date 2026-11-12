// Решение бота о наступлении на участке фронта (gdd/09-bots.md, «Война»): наступать, когда армия
// сильнее видимого врага у фронта в число раз из профиля сложности, держаться, пока слабее, и не
// стоять зря: застрявшую или выполненную линию строят заново. Раньше ▶ нажимал экономический мозг по
// выученным весам, и армия могла стоять вечно; теперь война — дело commander, а не весов.
import { warWith } from './war.ts';
import type { BotProfile } from '../balance.ts';
import type { Command } from '../commands/types.ts';
import { hexDistanceById, type HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import type { PlanView } from '../queries/plan-view.ts';
import type { PlayerView } from '../queries/player-view.ts';
import type { UnitView } from '../queries/unit-view.ts';
import { edgeOther, type EdgeId } from '../state/edges.ts';

/** Врага у фронта считаем в этом радиусе от его гексов за гранями фронта, гексов. */
const FORCE_RANGE = 4;

export type Stance = 'attack' | 'hold';

/**
 * Силы у участка фронта: свои солдаты армии против видимых вражеских отрядов и гарнизонов рядом.
 * @returns солдаты (fixed-point) своей армии и врага у фронта
 */
export function frontForces(
  view: PlayerView,
  width: number,
  army: readonly UnitView[],
  front: readonly EdgeId[],
  ground: Parameters<typeof edgeOther>[0],
): { mine: number; theirs: number } {
  const targets: HexId[] = [];
  for (const edge of front) {
    const other = edgeOther(ground, edge);
    if (other >= 0 && warWith(view, view.hexes.owner[other] ?? -1)) targets.push(other);
  }
  // Маска гексов в радиусе от гексов врага: проверка отряда — одно чтение, а не перебор всех целей.
  const mask = new Uint8Array(view.hexes.owner.length);
  const height = intDiv(mask.length, width);
  for (const target of targets) {
    const col = target % width;
    const row = intDiv(target, width);
    for (
      let r = Math.max(0, row - FORCE_RANGE);
      r <= Math.min(height - 1, row + FORCE_RANGE);
      r += 1
    ) {
      for (
        let c = Math.max(0, col - FORCE_RANGE);
        c <= Math.min(width - 1, col + FORCE_RANGE);
        c += 1
      ) {
        const hex = r * width + c;
        if (hexDistanceById(hex, target, width) <= FORCE_RANGE) mask[hex] = 1;
      }
    }
  }
  const near = (hex: HexId): boolean => mask[hex] === 1;
  let theirs = 0;
  for (const unit of view.units)
    if (warWith(view, unit.owner) && near(unit.hex)) theirs += unit.soldiers;
  for (const city of view.cities)
    if (warWith(view, city.owner) && near(city.hex)) theirs += city.defenders;
  const mine = army.reduce((sum, unit) => sum + unit.soldiers, 0);
  return { mine, theirs };
}

/**
 * Наступать или держаться. Идущее наступление терпит большую слабость (holdRatio), чем начало:
 * иначе армия то начинала бы, то бросала. Нет видимого врага — бить, пока есть чем.
 * @returns позиция на этот участок
 */
export function stance(
  forces: { mine: number; theirs: number },
  active: boolean,
  profile: BotProfile,
): Stance {
  if (forces.mine <= 0) return 'hold';
  if (forces.theirs <= 0) return 'attack';
  const ratio = intDiv(forces.mine * FP, forces.theirs);
  return ratio >= (active ? profile.holdRatio : profile.attackRatio) ? 'attack' : 'hold';
}

/** Линию наступления пора строить заново: её нет, она выполнена или армия на ней застряла. */
export function needsLine(plan: Extract<PlanView, { kind: 'front' }>, finished: boolean): boolean {
  return plan.offensive === null || plan.offensive === undefined || finished || plan.stuck;
}

/** Шаг лимита карточки: меньшее изменение заказа не отдаётся командой (закупка идёт по 50 солдат). */
const CARD_STEP = 50;
/** Запас над перевесом, при котором армия начинает наступать: заказ на четверть больше. */
const CARD_MARGIN: Fp = 1250 as Fp;

/**
 * Карточка армии бота — тот же лимит и состав, что игрок задаёт на карточке армии (`setArmyLimit`):
 * армию добирает общая закупка (`systems/procure.ts`), потери восполняются сами. Лимит растёт до
 * силы, с которой по профилю можно наступать на видимого врага у фронта, не больше доли людей и
 * армии государства, и никогда не падает ниже нынешней численности (иначе закупка отпускала бы
 * войска в резерв). Танки и артиллерия — доли заказа из профиля.
 * @returns команда нового заказа или пусто, если заказ не изменился
 */
export function armyCard(
  view: PlayerView,
  armyId: number,
  forces: { mine: number; theirs: number },
  profile: BotProfile,
): Command[] {
  const army = view.armies.find((a) => a.id === armyId);
  if (!army) return [];
  const have = intDiv(forces.mine, FP);
  const wanted = army.wanted ?? 0;
  const mineAll = view.units
    .filter((u) => u.owner === view.playerId)
    .reduce((sum, u) => sum + u.soldiers, 0);
  const cap = intDiv(intDiv(mineAll + view.me.popTotal, 2 * FP) * profile.armyCapPercent, 100);
  const enemy = intDiv(forces.theirs, FP);
  const need = intDiv(enemy * profile.attackRatio * CARD_MARGIN, FP * FP);
  const next = Math.max(wanted, have, Math.min(need, cap));
  const rounded = intDiv(next + CARD_STEP - 1, CARD_STEP) * CARD_STEP;
  const target = wanted === 0 ? Math.max(rounded, CARD_STEP) : rounded;
  if (wanted !== 0 && target - wanted < CARD_STEP) return [];
  const armor = intDiv(target * profile.armorPercent, 100);
  const artillery = intDiv(target * profile.artilleryPercent, 100);
  const mix = armor + artillery > 0 ? { mix: { armor, artillery } } : {};
  return [{ t: 'setArmyLimit', armyId, soldiers: target, ...mix }];
}
