// Снимок состояния для игрока: то, что клиент получает 10 раз в секунду.
// Архитектура: sim-core.md — «Запросы». Туман войны — этап 04: сейчас видно всё.
import { planViews, type PlanView } from './plan-view.ts';
import { playerPlace, playerScore } from './score.ts';
import { armyViews, unitViews, type ArmyView, type UnitView } from './unit-view.ts';
import type { UnitType } from '../balance.ts';
import { RECRUIT_STEP } from '../balance.ts';
import { foundCityCost } from '../commands/construction.ts';
import { rebuildSupplyPlan } from '../commands/rebuild-supply.ts';
import { recruitCapacity } from '../commands/recruit.ts';
import type { HexId } from '../math/hex.ts';
import { FP, type Fp } from '../math/int.ts';
import { isCityIsolated } from '../state/network.ts';
import type { ConstructionKind, MatchState } from '../state/types.ts';
import { createEconomyContext } from '../systems/economy-context.ts';
import {
  playerIncomePerSecond,
  playerUpkeepPerSecond,
  type IncomeBase,
} from '../systems/economy.ts';
import { taxGrowthMult } from '../systems/tax.ts';
import { visionSystem } from '../systems/vision.ts';

/** Связь узла сети: 0 — не узел, 1 — основная сеть, 2 — изолированная. */
export const LINK = { none: 0, main: 1, isolated: 2 } as const;

export interface PlayerViewContext {
  readonly growth: Int32Array;
  readonly incomeBases: readonly IncomeBase[];
  readonly links: Uint8Array;
}

export interface PlayerView {
  readonly tick: number;
  /** Победитель матча (08-match.md, «Победа»); -1 — матч идёт. */
  readonly winner: number;
  readonly playerId: number;
  readonly hexes: {
    readonly owner: Int16Array;
    readonly pop: Int32Array;
    readonly improvement: Uint8Array;
    readonly building: Uint8Array;
    readonly road: Uint8Array;
    /** Коды LINK. */
    readonly link: Uint8Array;
    /** Отладка /dev/economy: людей в секунду (fixed-point), отрицательное — убыль. */
    readonly growth: Int32Array;
    readonly visible: Uint8Array;
  };
  readonly cities: readonly {
    readonly id: number;
    readonly hex: HexId;
    readonly owner: number;
    readonly level: number;
    readonly name: string;
    readonly isCapital: boolean;
    readonly isolated: boolean;
    /** Ополчение или гарнизон, fixed-point солдат, и их организованность. */
    readonly defenders: Fp;
    readonly defenseOrg: Fp;
    /** Свой город: наибольший набор сейчас (карточка города), fixed-point солдат; чужой — 0. */
    readonly recruitMax: Fp;
    /** Свой изолированный город, до столицы есть путь для дороги (кнопка «Проложить дорогу»). */
    readonly canRebuild: boolean;
  }[];
  readonly units: readonly UnitView[];
  /** Свои армии — группы отрядов (CR-001). */
  readonly armies: readonly ArmyView[];
  /** Планы своих армий (CR-002). */
  readonly plans: readonly PlanView[];
  readonly players: readonly {
    readonly id: number;
    readonly gold: Fp;
    readonly taxTarget: Fp;
    readonly taxEffective: Fp;
    readonly status: string;
  }[];
  /** Сводка своего государства для верхней полосы (ui.md, «HUD»). */
  readonly me: {
    /** Людей всего и прирост, fixed-point (в секунду). */
    readonly popTotal: number;
    readonly popGrowthPerS: number;
    /** Золото в секунду при фактическом и при выбранном налоге. */
    readonly incomePerS: number;
    readonly incomeAtTargetPerS: number;
    /** Содержание отрядов, fixed-point золота в секунду. */
    readonly upkeepPerS: number;
    /** Коэффициент снабжения основной сети после учёта спроса отрядов, fixed-point. */
    readonly supplyLevel: Fp;
    /** Казна пуста при отрицательном балансе (02-economy.md, «Банкротство»). */
    readonly bankrupt: boolean;
    /** Переключатель «Автопополнение». */
    readonly autoReinforce: boolean;
    /** Настройка «Автокомандование» (CR-006). */
    readonly autoCommand: boolean;
    /** Цена основания следующего города, золото, fixed-point (03-cities-buildings.md). */
    readonly foundCityCost: Fp;
    /** Множитель роста населения при выбранном налоге, fixed-point. */
    readonly growthMultAtTarget: Fp;
    readonly score: number;
    readonly place: number;
    /** Живых игроков в матче. */
    readonly players: number;
  };
  readonly constructions: readonly {
    readonly id: number;
    readonly owner: number;
    readonly hex: HexId;
    readonly kind: ConstructionKind;
    readonly progressTicks: number;
    readonly totalTicks: number;
    readonly path: readonly HexId[];
  }[];
  /** Свои наборы в очереди городов; чужие не видны (08-match.md, «Туман войны»). */
  readonly recruits: readonly {
    readonly id: number;
    readonly cityId: number;
    readonly type: UnitType;
    readonly soldiers: Fp;
    readonly progressTicks: number;
    readonly totalTicks: number;
  }[];
}

function links(state: MatchState): Uint8Array {
  const main = new Set(state.networks.filter((n) => n.isMain).map((n) => n.id));
  return Uint8Array.from(state.hexes.network, (id) =>
    id < 0 ? LINK.none : main.has(id) ? LINK.main : LINK.isolated,
  );
}

function summary(
  state: MatchState,
  playerId: number,
  context: PlayerViewContext,
): PlayerView['me'] {
  let popTotal = 0;
  let popGrowthPerS = 0;
  state.hexes.owner.forEach((o, id) => {
    if (o !== playerId) return;
    popTotal += state.hexes.pop[id] ?? 0;
    popGrowthPerS += context.growth[id] ?? 0;
  });
  const target = state.players[playerId]?.taxTarget ?? (0 as Fp);
  return {
    popTotal,
    popGrowthPerS,
    incomePerS: playerIncomePerSecond(state, playerId, undefined, context.incomeBases),
    incomeAtTargetPerS: playerIncomePerSecond(state, playerId, target, context.incomeBases),
    upkeepPerS: playerUpkeepPerSecond(state, playerId),
    supplyLevel:
      state.supplyRatios.get(
        state.networks.find((network) => network.owner === playerId && network.isMain)?.id ?? -1,
      ) ?? (FP as Fp),
    bankrupt: state.players[playerId]?.bankrupt ?? false,
    autoReinforce: state.players[playerId]?.autoReinforce ?? false,
    autoCommand: state.players[playerId]?.autoCommand ?? true,
    foundCityCost: foundCityCost(state.players[playerId]?.citiesFounded ?? 0),
    growthMultAtTarget: taxGrowthMult(target),
    score: playerScore(state, playerId),
    place: playerPlace(state, playerId),
    players: state.players.filter((p) => p.status === 'alive').length,
  };
}

/**
 * Строит общий контекст снимков для одного состояния матча.
 * @returns рост людей в секунду, базы дохода и связи сетей
 */
export function createPlayerViewContext(state: MatchState): PlayerViewContext {
  visionSystem(state);
  const economy = createEconomyContext(state);
  return {
    growth: economy.growth,
    incomeBases: economy.incomeBases,
    links: links(state),
  };
}

// Наибольший набор в городе сейчас: ёмкость набора вниз до шага RECRUIT_STEP.
function recruitMax(state: MatchState, cityId: number): Fp {
  const cap = recruitCapacity(state, cityId);
  return (cap - (cap % RECRUIT_STEP)) as Fp;
}

/**
 * Снимок для игрока. Массивы — копии: клиент может их менять, состояние не пострадает.
 * @returns данные для отрисовки и интерфейса
 */
export function playerView(
  state: MatchState,
  playerId: number,
  context?: PlayerViewContext,
): PlayerView {
  // Контекст уже пересчитал обзор на этот тик; без контекста — как раньше.
  const viewContext = context ?? createPlayerViewContext(state);
  const { hexes } = state;
  const vision = state.vision;
  const visible = state.fog
    ? (vision?.visible[playerId] ?? new Uint8Array(hexes.owner.length).fill(1))
    : new Uint8Array(hexes.owner.length).fill(1);
  const memoryRoad = vision?.road[playerId];
  const memoryImprovement = vision?.improvement[playerId];
  const memoryBuilding = vision?.building[playerId];
  return {
    me: summary(state, playerId, viewContext),
    tick: state.tick,
    winner: state.winner,
    playerId,
    hexes: {
      // slice копирует типизированный массив целиком, без поэлементного обхода итератора.
      owner: hexes.owner.slice(),
      pop: state.fog
        ? Int32Array.from(hexes.pop, (value, id) => (hexes.owner[id] === playerId ? value : 0))
        : hexes.pop.slice(),
      improvement: state.fog
        ? Uint8Array.from(hexes.improvement, (_, id) => memoryImprovement?.[id] ?? 0)
        : hexes.improvement.slice(),
      building: state.fog
        ? Uint8Array.from(hexes.building, (_, id) => memoryBuilding?.[id] ?? 0)
        : hexes.building.slice(),
      road: state.fog
        ? Uint8Array.from(hexes.road, (_, id) => memoryRoad?.[id] ?? 0)
        : hexes.road.slice(),
      link: Uint8Array.from(viewContext.links, (value, id) => (visible[id] === 1 ? value : 0)),
      growth: state.fog
        ? Int32Array.from(viewContext.growth, (value, id) =>
            hexes.owner[id] === playerId ? value : 0,
          )
        : viewContext.growth,
      visible: visible.slice(),
    },
    cities: state.cities.map((c) => ({
      id: c.id,
      hex: c.hex,
      owner: c.owner,
      level: c.level,
      name: c.name,
      isCapital: state.players[c.owner]?.capitalCityId === c.id,
      isolated: isCityIsolated(state, c.id),
      defenders: c.defenders,
      defenseOrg: c.defenseOrg,
      recruitMax: c.owner === playerId ? recruitMax(state, c.id) : (0 as Fp),
      canRebuild:
        c.owner === playerId &&
        isCityIsolated(state, c.id) &&
        rebuildSupplyPlan(state, playerId, c.id).ok,
    })),
    units: unitViews(state, playerId, visible),
    armies: armyViews(state, playerId),
    plans: planViews(state, playerId),
    players: state.players.map((p) => ({
      id: p.id,
      gold: p.gold,
      taxTarget: p.taxTarget,
      taxEffective: p.taxEffective,
      status: p.status,
    })),
    constructions: state.constructions.map((c) => ({
      id: c.id,
      owner: c.owner,
      hex: c.hex,
      kind: c.kind,
      progressTicks: c.progressTicks,
      totalTicks: c.totalTicks,
      path: [...(c.path ?? [])],
    })),
    recruits: state.recruits
      .filter((r) => r.owner === playerId)
      .map((r) => ({
        id: r.id,
        cityId: r.cityId,
        type: r.type,
        soldiers: r.soldiers,
        progressTicks: r.progressTicks,
        totalTicks: r.totalTicks,
      })),
  };
}

/**
 * Снимок для commander без копирования массивов карты.
 * @returns данные, нужные автокомандованию; массивы карты принадлежат состоянию тика
 */
export function commanderView(
  state: MatchState,
  playerId: number,
  context: PlayerViewContext,
  cities = state.cities.map((c) => ({
    id: c.id,
    hex: c.hex,
    owner: c.owner,
    level: c.level,
    name: c.name,
    isCapital: state.players[c.owner]?.capitalCityId === c.id,
    isolated: false,
    defenders: c.defenders,
    defenseOrg: c.defenseOrg,
    recruitMax: 0 as Fp,
    canRebuild: false,
  })),
): PlayerView {
  const { hexes } = state;
  const visible = state.fog ? (state.vision?.visible[playerId] ?? new Uint8Array(0)) : undefined;
  return {
    me: {
      popTotal: 0,
      popGrowthPerS: 0,
      incomePerS: 0,
      incomeAtTargetPerS: 0,
      upkeepPerS: 0,
      supplyLevel: FP as Fp,
      bankrupt: false,
      autoReinforce: false,
      autoCommand: true,
      foundCityCost: 0 as Fp,
      growthMultAtTarget: FP as Fp,
      score: 0,
      place: 0,
      players: 0,
    },
    tick: state.tick,
    winner: state.winner,
    playerId,
    hexes: {
      owner: hexes.owner,
      pop: hexes.pop,
      improvement: hexes.improvement,
      building: hexes.building,
      road: hexes.road,
      link: context.links,
      growth: context.growth,
      visible: visible ?? new Uint8Array(0),
    },
    cities,
    units: unitViews(state, playerId, visible),
    armies: armyViews(state, playerId),
    plans: planViews(state, playerId),
    players: state.players,
    constructions: [],
    recruits: [],
  };
}
