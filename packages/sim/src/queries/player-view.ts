// Снимок состояния для игрока: то, что клиент получает 10 раз в секунду.
// Архитектура: sim-core.md — «Запросы». Туман войны — этап 04: сейчас видно всё.
import { forecastBattle } from './forecast.ts';
import { planViews, type PlanView } from './plan-view.ts';
import { playerPlace, playerPlaces, playerScore, playerScores } from './score.ts';
import {
  armyViews,
  unitViews,
  type ArmyView,
  type AttackState,
  type UnitView,
} from './unit-view.ts';
import {
  NO_CITY_GRACE_S,
  RECRUIT_STEP,
  TICKS_PER_S,
  VOTE_TTL_TICKS,
  type UnitType,
} from '../balance.ts';
import { foundCityCost } from '../commands/construction.ts';
import { rebuildSupplyPlan } from '../commands/rebuild-supply.ts';
import { recruitCapacity } from '../commands/recruit.ts';
import type { HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { memo } from '../state/derived.ts';
import { memoryRevision } from '../state/layers.ts';
import { isCityIsolated } from '../state/network.ts';
import { OFFER_TTL_TICKS, allianceOf, groupOf, relationOf } from '../state/relations.ts';
import type { Relation, TreatyKind } from '../state/types.ts';
import type { ConstructionKind, Diplomacy, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';
import {
  incomeBases,
  playerIncomePerSecond,
  playerUpkeepPerSecond,
  type IncomeBase,
} from '../systems/economy.ts';
import { growthPerSecond } from '../systems/population.ts';
import { taxGrowthMult } from '../systems/tax.ts';
import { visionSystem } from '../systems/vision.ts';

/** Связь узла сети: 0 — не узел, 1 — основная сеть, 2 — изолированная. */
export const LINK = { none: 0, main: 1, isolated: 2 } as const;

export interface PlayerViewContext {
  readonly growth: Int32Array;
  readonly incomeBases: readonly IncomeBase[];
  readonly links: Uint8Array;
  readonly scores: Int32Array;
  readonly places: Int32Array;
}

export interface PlayerRanking {
  readonly id: number;
  readonly score: number;
  readonly place: number;
}

export interface VictoryHold {
  readonly player: number;
  readonly seconds: number;
}

export interface PlayerView {
  readonly tick: number;
  /** Победитель матча (08-match.md, «Победа»); -1 — матч идёт. */
  readonly winner: number;
  readonly playerId: number;
  readonly victoryHold?: VictoryHold | null;
  /** Дипломатия (CR-007): есть только в матче с дипломатией. */
  readonly diplomacy?: DiplomacyView;
  readonly ranking?: readonly PlayerRanking[];
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
    readonly name?: string;
    readonly gold: Fp;
    readonly taxTarget: Fp;
    readonly taxEffective: Fp;
    readonly status: string;
    /** Секунд до выбывания, пока у игрока нет городов (виден всем: капитуляция врага). */
    readonly graceLeftS?: number;
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
    /** Секунд до выбывания, пока нет городов (08-match.md, «Выбывание»); нет поля — города есть. */
    readonly graceLeftS?: number;
  };
  readonly constructions: readonly {
    readonly id: number;
    readonly owner: number;
    readonly hex: HexId;
    readonly kind: ConstructionKind;
    readonly progressTicks: number;
    readonly totalTicks: number;
    readonly path: readonly HexId[];
    /** Дорога проложена игроком вручную. */
    readonly manual?: boolean;
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

function victoryHold(state: MatchState): VictoryHold | null {
  if (state.holdPlayer < 0) return null;
  return {
    player: state.holdPlayer,
    seconds: intDiv(Math.max(0, state.holdTicks), TICKS_PER_S),
  };
}

function links(state: MatchState): Uint8Array {
  const main = new Set(state.networks.filter((n) => n.isMain).map((n) => n.id));
  const network = state.hexes.network;
  const out = new Uint8Array(network.length);
  for (let hex = 0; hex < network.length; hex += 1) {
    const id = network[hex] ?? -1;
    out[hex] = id < 0 ? LINK.none : main.has(id) ? LINK.main : LINK.isolated;
  }
  return out;
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
    score: context.scores[playerId] ?? playerScore(state, playerId),
    place: context.places[playerId] ?? playerPlace(state, playerId),
    players: state.players.filter((p) => p.status === 'alive').length,
    ...graceLeft(state, playerId),
  };
}

// Остаток 60-секундной отсрочки безгородья, секунды с округлением вверх.
function graceLeft(state: MatchState, playerId: number): { readonly graceLeftS?: number } {
  const player = state.players[playerId];
  if (!player || player.status !== 'alive' || player.noCityTicks <= 0) return {};
  const total = intDiv(NO_CITY_GRACE_S * TICKS_PER_S, FP);
  const left = Math.max(0, total - player.noCityTicks);
  return { graceLeftS: intDiv(left + TICKS_PER_S - 1, TICKS_PER_S) };
}

/**
 * Строит общий контекст снимков для одного состояния матча.
 * @returns рост людей в секунду, базы дохода и связи сетей
 */
export function createPlayerViewContext(state: MatchState): PlayerViewContext {
  visionSystem(state);
  const scores = playerScores(state);
  return {
    growth: growthPerSecond(state),
    incomeBases: incomeBases(state),
    links: links(state),
    scores,
    places: playerPlaces(state, scores),
  };
}

// Наибольший набор в городе сейчас: ёмкость набора вниз до шага RECRUIT_STEP.
function recruitMax(state: MatchState, cityId: number): Fp {
  const cap = recruitCapacity(state, cityId);
  return (cap - (cap % RECRUIT_STEP)) as Fp;
}

// Простые циклы по типизированным массивам: `TypedArray.from(src, fn)` вызывает функцию на каждый
// гекс и на больших картах съедал половину тика на каждого игрока.
function ownedOnly(values: Int32Array, owner: Int16Array, playerId: number): Int32Array {
  const out = new Int32Array(values.length);
  for (let id = 0; id < values.length; id += 1) {
    if (owner[id] === playerId) out[id] = values[id] ?? 0;
  }
  return out;
}

function visibleOnly(values: Uint8Array, visible: Uint8Array): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let id = 0; id < values.length; id += 1) {
    if (visible[id] === 1) out[id] = values[id] ?? 0;
  }
  return out;
}

function memoryCopy(memory: Uint8Array | undefined, length: number): Uint8Array {
  return memory ? memory.slice() : new Uint8Array(length);
}

// Слои вида, общие для всех игроков, делятся между видами и тиками, пока не меняется их слой
// состояния (версии — state/layers.ts): вместо копии на игрока на тик. Слои вида только для чтения.
function sharedOwner(state: MatchState): Int16Array {
  return memo(state, 'view.owner', ['owner'], () => state.hexes.owner.slice());
}

function openLayers(state: MatchState): {
  readonly improvement: Uint8Array;
  readonly building: Uint8Array;
  readonly road: Uint8Array;
} {
  return memo(state, 'view.open', ['improvement', 'building', 'road'], () => ({
    improvement: state.hexes.improvement.slice(),
    building: state.hexes.building.slice(),
    road: state.hexes.road.slice(),
  }));
}

// Память тумана игрока: копии дорог, улучшений и построек, пока игрок не увидел ничего нового.
function memoryLayers(
  state: MatchState,
  playerId: number,
): { readonly improvement: Uint8Array; readonly building: Uint8Array; readonly road: Uint8Array } {
  const vision = state.vision;
  const length = state.hexes.owner.length;
  return memo(
    state,
    `view.memory.${playerId}`,
    [],
    () => ({
      improvement: memoryCopy(vision?.improvement[playerId], length),
      building: memoryCopy(vision?.building[playerId], length),
      road: memoryCopy(vision?.road[playerId], length),
    }),
    [memoryRevision(state, playerId)],
  );
}

/** Слои вида, которые вызывающий уже имеет и не хочет считать заново (например, медленные). */
export type PlayerViewReuse = Partial<Pick<PlayerView['hexes'], 'pop' | 'growth'>>;

/**
 * Снимок для игрока. Слои гексов — отдельные от состояния копии (изменение вида состояние не
 * затрагивает), но общие между видами и тиками, пока не менялся их слой: менять их нельзя.
 * `reuse` — слои, которые не нужно считать (вызывающий передаёт прежние для медленных слоёв).
 * @returns данные для отрисовки и интерфейса
 */
export function playerView(
  state: MatchState,
  playerId: number,
  context?: PlayerViewContext,
  reuse?: PlayerViewReuse,
): PlayerView {
  // Контекст уже пересчитал обзор на этот тик; без контекста — как раньше.
  const viewContext = context ?? createPlayerViewContext(state);
  const { hexes } = state;
  const vision = state.vision;
  const visible = state.fog
    ? (vision?.visible[playerId] ?? new Uint8Array(hexes.owner.length).fill(1))
    : new Uint8Array(hexes.owner.length).fill(1);
  const layers = state.fog ? memoryLayers(state, playerId) : openLayers(state);
  const diplomacy = diplomacyView(state, playerId);
  const ranking = Array.from(viewContext.scores, (score, id) => ({
    id,
    score,
    place: viewContext.places[id] ?? 0,
  }));
  const view: PlayerView = {
    me: summary(state, playerId, viewContext),
    tick: state.tick,
    winner: state.winner,
    playerId,
    victoryHold: victoryHold(state),
    ranking,
    ...(diplomacy ? { diplomacy } : {}),
    hexes: {
      owner: sharedOwner(state),
      pop:
        reuse?.pop ?? (state.fog ? ownedOnly(hexes.pop, hexes.owner, playerId) : hexes.pop.slice()),
      improvement: layers.improvement,
      building: layers.building,
      road: layers.road,
      link: visibleOnly(viewContext.links, visible),
      growth:
        reuse?.growth ??
        (state.fog ? ownedOnly(viewContext.growth, hexes.owner, playerId) : viewContext.growth),
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
      ...(p.name ? { name: p.name } : {}),
      // Казну и налог чужих не показываем: это закрытые данные и шум в дельте (меняются каждый тик).
      gold: p.id === playerId ? p.gold : (0 as Fp),
      taxTarget: p.id === playerId ? p.taxTarget : (0 as Fp),
      taxEffective: p.id === playerId ? p.taxEffective : (0 as Fp),
      status: p.status,
      ...graceLeft(state, p.id),
    })),
    constructions: state.constructions
      .filter((c) => c.owner === playerId || visible[c.hex] === 1)
      .map((c) => ({
        id: c.id,
        owner: c.owner,
        hex: c.hex,
        kind: c.kind,
        progressTicks: c.progressTicks,
        totalTicks: c.totalTicks,
        path: [...(c.path ?? [])],
        ...(c.manual === true ? { manual: true } : {}),
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
  return {
    ...view,
    units: view.units.map((unit) => ({
      ...unit,
      attackState: attackState(state, view, unit),
    })),
  };
}

function attackState(state: MatchState, view: PlayerView, unit: UnitView): AttackState | null {
  if (unit.order !== 'attack' || unit.target < 0) return null;
  const localDefender =
    view.units.some(
      (candidate) => candidate.owner === view.playerId && candidate.hex === unit.target,
    ) ||
    view.cities.some(
      (candidate) =>
        candidate.owner === view.playerId &&
        candidate.hex === unit.target &&
        candidate.defenders > 0 &&
        candidate.defenseOrg > 0,
    );
  if (unit.owner !== view.playerId && !localDefender) return null;
  const perspective =
    unit.owner === view.playerId
      ? view
      : { ...view, playerId: unit.owner, units: unitViews(state, unit.owner) };
  const attackerIds = allUnits(state)
    .filter(
      (candidate) =>
        candidate.owner === unit.owner &&
        candidate.order === 'attack' &&
        candidate.target === unit.target,
    )
    .map((candidate) => candidate.id);
  const forecast = forecastBattle(state.map, perspective, attackerIds, unit.target);
  const attackerTime = forecast.attackerTimeS ?? 0;
  const defenderTime = forecast.defenderTimeS ?? 0;
  const totalTime = attackerTime + defenderTime;
  const attackerAdvantage =
    totalTime === 0 ? 100 : intDiv(100 * attackerTime + intDiv(totalTime, 2), totalTime);
  const advantage = localDefender ? 100 - attackerAdvantage : attackerAdvantage;
  const status = localDefender
    ? forecast.outcome === 'victory'
      ? 'danger'
      : forecast.outcome === 'defeat'
        ? 'success'
        : 'warning'
    : forecast.outcome === 'victory'
      ? 'success'
      : forecast.outcome === 'defeat'
        ? 'danger'
        : 'warning';
  return { target: unit.target, advantage, status };
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
    victoryHold: null,
    ranking: [],
    ...(diplomacyView(state, playerId)
      ? { diplomacy: diplomacyView(state, playerId) as DiplomacyView }
      : {}),
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

/** Что игрок знает о дипломатии: свои отношения с каждым, нарушения всех, предложения ему и от него. */
export interface DiplomacyView {
  /** Отношение игрока к каждому игроку по индексу (к себе — peace). */
  readonly relations: readonly Relation[];
  /** Нарушений договоров у каждого игрока (видно всем). */
  readonly violations: readonly number[];
  readonly incoming: readonly { readonly from: number; readonly kind: TreatyKind }[];
  readonly outgoing: readonly { readonly to: number; readonly kind: TreatyKind }[];
  /** Запросы помощи мне (оборонительный пакт): вступить ли в войну с агрессором за пострадавшего. */
  readonly aidCalls: readonly { readonly victim: number; readonly aggressor: number }[];
  /** Голосования альянса, где я избиратель: ход голосов и мой ответ (null — ещё не ответил). */
  readonly votes: readonly {
    readonly id: number;
    readonly kind: 'join' | 'peace' | 'kick';
    readonly a: number;
    readonly b: number;
    readonly voters: readonly number[];
    /** Общий мир: стороны, каждая решает большинством своих членов; для входа в альянс пусто. */
    readonly sides: readonly (readonly number[])[];
    readonly yes: readonly number[];
    readonly no: readonly number[];
    /** Секунд до конца голосования (не решили — отказ). */
    readonly leftS: number;
    readonly mine: 'yes' | 'no' | null;
    /** Могу ли я голосовать (инициатор и исключаемый могут лишь смотреть). */
    readonly canVote: boolean;
    /** Итог: принято, отклонено или null, пока идёт голосование. */
    readonly result: 'passed' | 'failed' | null;
  }[];
  /** Альянс каждого игрока по индексу: номер блока (наименьший id члена); одиночка — свой id. */
  readonly blocs: readonly number[];
  /** Состав моего альянса (без меня). */
  readonly allies: readonly number[];
}

// Голосования для игрока: идущие и недавно законченные, где он избиратель, инициатор или цель.
function voteViews(state: MatchState, d: Diplomacy, me: number): DiplomacyView['votes'] {
  const involved = (v: { voters: readonly number[]; a: number; b: number }): boolean =>
    v.voters.includes(me) || v.a === me || v.b === me;
  const view = (
    v: {
      id: number;
      kind: 'join' | 'peace' | 'kick';
      a: number;
      b: number;
      voters: readonly number[];
      sides?: readonly (readonly number[])[];
      yes: readonly number[];
      no: readonly number[];
      tick: number;
    },
    result: 'passed' | 'failed' | null,
  ): DiplomacyView['votes'][number] => ({
    id: v.id,
    kind: v.kind,
    a: v.a,
    b: v.b,
    voters: [...v.voters],
    sides: (v.sides ?? []).map((side) => [...side]),
    yes: [...v.yes],
    no: [...v.no],
    leftS:
      result === null
        ? intDiv(Math.max(0, VOTE_TTL_TICKS - (state.tick - v.tick)) + TICKS_PER_S - 1, TICKS_PER_S)
        : 0,
    mine: v.yes.includes(me) ? 'yes' : v.no.includes(me) ? 'no' : null,
    canVote: v.voters.includes(me),
    result,
  });
  return [
    ...(d.votes ?? []).filter(involved).map((v) => view(v, null)),
    ...(d.results ?? []).filter(involved).map((r) => view(r, r.passed ? 'passed' : 'failed')),
  ];
}

export function diplomacyView(state: MatchState, playerId: number): DiplomacyView | null {
  const d = state.diplomacy;
  if (!d) return null;
  // Предложение выбывшего игрока (или ему) уже не имеет смысла: ответить некому, висеть оно не должно.
  const alive = (id: number): boolean => state.players[id]?.status === 'alive';
  const live = d.offers.filter(
    (o) => state.tick - o.tick < OFFER_TTL_TICKS && alive(o.from) && alive(o.to),
  );
  return {
    relations: state.players.map((p) =>
      p.id === playerId ? 'peace' : relationOf(state, playerId, p.id),
    ),
    violations: [...d.violations],
    incoming: live.filter((o) => o.to === playerId).map((o) => ({ from: o.from, kind: o.kind })),
    outgoing: live.filter((o) => o.from === playerId).map((o) => ({ to: o.to, kind: o.kind })),
    aidCalls: (d.calls ?? [])
      .filter((c) => c.ally === playerId)
      .map((c) => ({ victim: c.victim, aggressor: c.aggressor })),
    votes: voteViews(state, d, playerId),
    blocs: state.players.map((p) => groupOf(state, p.id)[0] ?? p.id),
    allies: allianceOf(state, playerId),
  };
}
