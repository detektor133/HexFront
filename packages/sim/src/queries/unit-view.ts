// Отряды и армии в снимке игрока. Туман войны — этап 04: пока видны все отряды, но скрытое
// у чужих (снабжение, армия, путь) не передаётся (08-match.md, «Туман войны»).
import type { UnitType } from '../balance.ts';
import { isSupportedByArtillery } from './battle-math.ts';
import { TERRAIN } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import type { Fp } from '../math/int.ts';
import type { MatchState, Unit, UnitOrder } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';
import { isStarving } from '../systems/attrition.ts';
import { starsOf } from '../systems/experience.ts';

/** Отряд в снимке; поля null/пусто у чужих отрядов. */
export interface UnitView {
  readonly id: number;
  readonly owner: number;
  readonly type: UnitType;
  readonly soldiers: Fp;
  readonly org: Fp;
  readonly hex: HexId;
  readonly order: UnitOrder;
  readonly inBattle?: boolean | null;
  /** Цель атаки или -1. */
  readonly target: HexId;
  /** Прогресс перехода для интерполяции, тики. */
  readonly moveTicks: number;
  readonly moveTotal: number;
  /** Снабжённость — только своих отрядов; у чужих неизвестна. */
  readonly supplyLevel: Fp | null;
  readonly encircled: boolean | null;
  /** Отряд плывёт по воде между портами. */
  readonly sea: boolean;
  /** Свой отряд прямо сейчас теряет солдат от истощения; у чужих неизвестно. */
  readonly starving: boolean | null;
  readonly armyId: number | null;
  readonly path: readonly HexId[];
  /** Своя артиллерия: по кому бьёт сейчас, иначе -1. */
  readonly fireTarget: number;
  /** Свой отряд: гекс сбора при приказе gather, иначе -1. */
  readonly gather?: HexId;
  /** Атакующий неартиллерийский отряд получает бонус от своей артиллерии. */
  readonly artillerySupport: boolean;
  /** Звёзды опыта армии 0..3: видны и у чужих отрядов. */
  readonly stars?: number;
  readonly attackState?: AttackState | null;
}

/** Локальная оценка боя для отряда, участвующего в атаке. */
export interface AttackState {
  readonly target: HexId;
  readonly advantage: number;
  readonly status: 'success' | 'warning' | 'danger';
}

/** Своя армия в снимке. */
export interface ArmyView {
  readonly id: number;
  readonly number: number;
  readonly name: string;
  /** Автокомандование (CR-006). */
  readonly auto: boolean;
  /** Звёзды опыта армии 0..3. */
  readonly stars?: number;
  /** Заказанная численность, солдат: ИИ закупает и подводит недостающих (меню страны). */
  readonly wanted?: number;
  /** Состав заказа: танки и артиллерия (остальное — пехота); нет поля — тип не важен. */
  readonly mix?: { readonly armor: number; readonly artillery: number };
  /** Направление армии: цель (id игрока или -1 — ничья земля) и режим. */
  readonly dir?: {
    readonly target: number;
    readonly mode: 'hold' | 'attack' | 'idle';
    readonly bloc?: true;
  };
  /** Армия в морском десанте: отряд на воде или его путь ведёт через воду (значок якоря). */
  readonly sea?: boolean;
}

/** Отряды для снимка игрока playerId. */
export function unitViews(state: MatchState, playerId: number, visible?: Uint8Array): UnitView[] {
  // Поддержка артиллерии зависит только от цели атаки: сто отрядов на один гекс считают её раз.
  const supportedTargets = new Map<number, boolean>();
  const supported = (target: number): boolean => {
    let value = supportedTargets.get(target);
    if (value === undefined) {
      value = isSupportedByArtillery(state.map, state.units, playerId, target);
      supportedTargets.set(target, value);
    }
    return value;
  };
  return allUnits(state)
    .filter((u) => u.owner === playerId || (visible?.[u.hex] ?? 1) === 1)
    .map((u) => {
      const mine = u.owner === playerId;
      return {
        id: u.id,
        owner: u.owner,
        type: u.type,
        soldiers: u.soldiers,
        org: u.org,
        hex: u.hex,
        order: u.order,
        inBattle: mine ? u.inBattle : null,
        target: u.target,
        moveTicks: u.moveTicks,
        moveTotal: u.moveTotal,
        supplyLevel: mine ? u.supplyLevel : null,
        encircled: mine ? u.encircled : null,
        sea: u.sea,
        starving: isStarving(u),
        armyId: mine ? u.armyId : null,
        path: mine ? [...u.path] : [],
        fireTarget: mine ? u.fireTarget : -1,
        stars: u.stars ?? 0,
        gather: mine ? u.gather : -1,
        artillerySupport:
          mine && u.type !== 'artillery' && u.order === 'attack' && supported(u.target),
        attackState: null,
      };
    });
}

/** Отряд на воде или с путём через воду: десант ещё не высадился. */
export function onSeaMission(state: MatchState, u: Unit): boolean {
  return u.sea || u.path.some((h) => state.map.terrain[h] === TERRAIN.water);
}

/** Свои армии для снимка. */
export function armyViews(state: MatchState, playerId: number): ArmyView[] {
  const landing = new Set<number>();
  for (const u of allUnits(state)) {
    if (u.owner !== playerId || u.armyId === null || landing.has(u.armyId)) continue;
    if (onSeaMission(state, u)) landing.add(u.armyId);
  }
  return state.armies
    .filter((a) => a.owner === playerId)
    .map((a) => ({
      id: a.id,
      number: a.number,
      name: a.name,
      auto: a.auto,
      stars: starsOf(a.xp ?? 0),
      ...(a.wanted === undefined ? {} : { wanted: a.wanted }),
      ...(a.mix === undefined ? {} : { mix: a.mix }),
      ...(a.dir === undefined ? {} : { dir: a.dir }),
      ...(a.invading === true && landing.has(a.id) ? { sea: true } : {}),
    }));
}
