// Производный индекс занятости гексов отрядами; он не входит в хэш MatchState.
// GDD: docs/gdd/05-armies.md — «Движение», «Разделение и слияние».
import type { City, MatchState, Unit } from './types.ts';
import type { HexId } from '../math/hex.ts';

export interface UnitHexIndex {
  readonly unitsByHex: Array<Unit[] | undefined>;
  readonly cityByHex: Array<City | undefined>;
}

const indexes = new WeakMap<MatchState, UnitHexIndex>();

function addToBucket(index: UnitHexIndex, unit: Unit): void {
  const bucket = index.unitsByHex[unit.hex] ?? [];
  bucket.push(unit);
  index.unitsByHex[unit.hex] = bucket;
}

/** Полностью строит производные индексы после создания или загрузки состояния. */
export function rebuildUnitIndex(state: MatchState): UnitHexIndex {
  const index: UnitHexIndex = {
    unitsByHex: new Array<Unit[] | undefined>(state.map.width * state.map.height),
    cityByHex: new Array<City | undefined>(state.map.width * state.map.height),
  };
  for (const unit of state.units) addToBucket(index, unit);
  for (const city of state.cities) index.cityByHex[city.hex] = city;
  indexes.set(state, index);
  return index;
}

/** Возвращает индекс, восстанавливая его для состояния после сериализации. */
export function unitIndex(state: MatchState): UnitHexIndex {
  return indexes.get(state) ?? rebuildUnitIndex(state);
}

/** Возвращает массив отрядов для чтения без прямого обращения к контейнеру состояния. */
export function allUnits(state: MatchState): readonly Unit[] {
  return state.units;
}

/** Добавляет новый отряд в уже созданный индекс. */
export function addUnitToIndex(state: MatchState, unit: Unit): void {
  const index = indexes.get(state);
  if (index) addToBucket(index, unit);
}

/** Добавляет отряд в состояние и производный индекс одной операцией. */
export function addUnit(state: MatchState, unit: Unit): void {
  state.units.push(unit);
  addUnitToIndex(state, unit);
}

/** Удаляет отряд из индекса перед удалением из MatchState. */
export function removeUnitFromIndex(state: MatchState, unit: Unit): void {
  const index = indexes.get(state);
  const bucket = index?.unitsByHex[unit.hex];
  if (!bucket) return;
  const position = bucket.indexOf(unit);
  if (position >= 0) bucket.splice(position, 1);
  if (bucket.length === 0 && index) index.unitsByHex[unit.hex] = undefined;
}

/** Переносит отряд между корзинами индекса после изменения его гекса. */
export function moveUnitInIndex(state: MatchState, unit: Unit, from: HexId): void {
  const index = indexes.get(state);
  if (!index || from === unit.hex) return;
  const oldBucket = index.unitsByHex[from];
  const position = oldBucket?.indexOf(unit) ?? -1;
  if (oldBucket && position >= 0) oldBucket.splice(position, 1);
  if (oldBucket?.length === 0) index.unitsByHex[from] = undefined;
  addToBucket(index, unit);
}

/** Перемещает отряд в состоянии и производном индексе одной операцией. */
export function moveUnit(state: MatchState, unit: Unit, to: HexId): void {
  const from = unit.hex;
  if (from === to) return;
  unit.hex = to;
  moveUnitInIndex(state, unit, from);
}

/** Удаляет набор отрядов из состояния и производного индекса одной операцией. */
export function removeUnits(state: MatchState, units: readonly Unit[]): void {
  if (units.length === 0) return;
  const removed = new Set(units);
  for (const unit of units) removeUnitFromIndex(state, unit);
  const survivors = state.units.filter((unit) => !removed.has(unit));
  state.units.splice(0, state.units.length, ...survivors);
}

/** Добавляет город в индекс после основания города. */
export function addCityToIndex(state: MatchState, city: City): void {
  const index = indexes.get(state);
  if (index) index.cityByHex[city.hex] = city;
}

/** Проверяет индекс полным построением; используется только тестами эквивалентности. */
export function indexMatchesUnits(state: MatchState): boolean {
  return unitIndexMismatch(state) === null;
}

/** Возвращает первую рассинхронизацию индекса с гексом и id отряда. */
export function unitIndexMismatch(state: MatchState): string | null {
  const index = unitIndex(state);
  const expected = new Map<HexId, Unit[]>();
  for (const unit of state.units) {
    const bucket = expected.get(unit.hex) ?? [];
    bucket.push(unit);
    expected.set(unit.hex, bucket);
  }
  for (let hex = 0; hex < index.unitsByHex.length; hex += 1) {
    const actual = (index.unitsByHex[hex] ?? []).map((unit) => unit.id).sort((a, b) => a - b);
    const wanted = (expected.get(hex) ?? []).map((unit) => unit.id).sort((a, b) => a - b);
    if (actual.length !== wanted.length || actual.some((id, i) => id !== wanted[i])) {
      const unitId = actual.find((id) => !wanted.includes(id)) ?? wanted[0] ?? actual[0] ?? -1;
      return `гекс ${hex}, отряд ${unitId}: индекс не совпадает с state.units`;
    }
  }
  return null;
}
