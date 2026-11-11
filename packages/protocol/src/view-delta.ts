// Дельта вида игрока: что изменилось относительно последнего подтверждённого вида.
//
// Принципы (docs/architecture/protocol.md, «Принципы формата»):
//  1. Формат выводится из СТРУКТУРЫ PlayerView, а не из списка полей. Новое поле вида едет по сети
//     само: его не нужно регистрировать ни здесь, ни в клиенте.
//  2. Коллекции с id (отряды, города…) передаются патчами: новая запись целиком, изменённая — только
//     изменившиеся поля. Остальные поля вида — целиком, если изменились.
//  3. Слои гексов — колонками «зазор по id, значение»: нет объекта на гекс, числа короткие.
//  4. Корректность держат тесты-предохранители (view-delta-roundtrip): дельта по реальному матчу
//     обязана восстановить вид побитово.
import type { GameEvent, PlayerView, PlayerViewReuse } from '@hexfront/sim';

type HexLayer = keyof PlayerView['hexes'];
type Fields = Record<string, unknown>;

/** Коллекции вида с ключом; в виде они отсортированы по ключу (проверяет тест-предохранитель). */
const KEYED = {
  units: 'id',
  cities: 'id',
  players: 'id',
  ranking: 'id',
  armies: 'id',
  constructions: 'id',
  recruits: 'id',
  plans: 'armyId',
} as const;
type KeyedName = keyof typeof KEYED;
const KEYED_NAMES = Object.keys(KEYED) as KeyedName[];

/** Объекты, которые патчатся по полям (одна запись на игрока). */
const RECORDS = ['me'] as const;
type RecordName = (typeof RECORDS)[number];

/** Поля вида, которые не едут «целиком»: тик, слои гексов, коллекции и патчируемые записи. */
const SPECIAL = new Set<string>(['tick', 'hexes', ...KEYED_NAMES, ...RECORDS]);

/** Слой гексов: пары `[зазор от прошлого id, новое значение]` подряд. */
export type HexColumns = Partial<Record<HexLayer, number[]>>;

/** Изменённая запись: ключ и только изменившиеся поля; `$unset` — исчезнувшие поля. */
export type Patch = Fields & { readonly $unset?: readonly string[] };

export interface KeyedDelta {
  /** Новые записи целиком. */
  readonly add: readonly unknown[];
  /** Известные записи: ключ и изменившиеся поля. */
  readonly patch: readonly Patch[];
  readonly removed: readonly number[];
}

export interface ViewDelta {
  readonly hexes: HexColumns;
  readonly keyed: Partial<Record<KeyedName, KeyedDelta>>;
  readonly records?: Partial<Record<RecordName, Patch>>;
  /** Остальные поля вида (победа, дипломатия, наборы…), изменившиеся целиком. */
  readonly whole?: Fields;
  /** Необязательные поля вида, которых больше нет. */
  readonly unset?: readonly string[];
  readonly events: readonly GameEvent[];
}

export interface DeltaMessage {
  readonly t: 'delta';
  readonly baseTick: number;
  readonly tick: number;
  readonly d: ViewDelta;
}

// --- Темп обновления -------------------------------------------------------------------------
//
// По умолчанию КАЖДОЕ поле вида едет каждый тик. Медленные поля — явный и короткий список ниже:
// игроку хватает раза в секунду (население, экономика, сводка обороны города). Новое поле вида
// «медленным» не станет само, поэтому добавить поле нельзя так, чтобы оно тихо запаздывало.

/** Как часто (в тиках) обновляются медленные поля. */
export const SLOW_PERIOD_TICKS = 10;

// Медленные слои должны уметь повторно использоваться при сборке вида (PlayerViewReuse): тип проверяет это.
const SLOW_LAYERS = ['pop', 'growth'] as const satisfies readonly (HexLayer &
  keyof PlayerViewReuse)[];
const SLOW_FIELDS = {
  me: [
    'popTotal',
    'popGrowthPerS',
    'incomePerS',
    'incomeAtTargetPerS',
    'upkeepPerS',
    'supplyLevel',
    'score',
    'place',
    'players',
  ],
  cities: ['defenders', 'defenseOrg', 'recruitMax'],
  ranking: ['score', 'place'],
} as const;

/** Копия записи без перечисленных полей (без `Object.fromEntries`: горячий путь, каждый тик каждому игроку). */
function without(item: Fields, names: readonly string[]): Fields {
  const copy: Fields = { ...item };
  for (const name of names) Reflect.deleteProperty(copy, name);
  return copy;
}

function pickFields(from: Fields, to: Fields, names: readonly string[]): Fields {
  // Чаще всего медленные поля не отличаются от базы: тогда копию не делаем.
  let same = true;
  for (const name of names) {
    if (!(name in from) || !equalValue(from[name], to[name])) {
      same = false;
      break;
    }
  }
  if (same) return to;
  const result: Fields = { ...to };
  for (const name of names) {
    if (name in from) result[name] = from[name];
    else Reflect.deleteProperty(result, name);
  }
  return result;
}

function paceList(
  base: readonly Fields[] | undefined,
  list: readonly Fields[] | undefined,
  names: readonly string[],
): Fields[] | undefined {
  if (!list || !base) return list as Fields[] | undefined;
  // Оба списка отсортированы по id: идём слиянием, без Map.
  let j = 0;
  return list.map((item) => {
    while (j < base.length && (base[j]?.id as number) < (item.id as number)) j += 1;
    const old = base[j];
    return old !== undefined && old.id === item.id ? pickFields(old, item, names) : item;
  });
}

/**
 * Вид, каким он окажется у клиента: медленные поля остаются как в подтверждённой базе, пока не
 * пришёл срок (`sync`). Сервер обязан хранить как новую базу ИМЕННО этот вид, а не «сырой»:
 * иначе пропущенные изменения никогда не дойдут до клиента.
 */
export function paceView(base: PlayerView, view: PlayerView, sync: boolean): PlayerView {
  if (sync) return view;
  const hexes = { ...view.hexes };
  for (const layer of SLOW_LAYERS) {
    if (base.hexes[layer].length === view.hexes[layer].length) {
      (hexes as Record<string, unknown>)[layer] = base.hexes[layer];
    }
  }
  const next: Fields = { ...(view as unknown as Fields), hexes };
  next.me = pickFields(base.me as Fields, view.me as Fields, SLOW_FIELDS.me);
  for (const name of ['cities', 'ranking'] as const) {
    const list = paceList(
      base[name] as unknown as Fields[] | undefined,
      view[name] as unknown as Fields[] | undefined,
      SLOW_FIELDS[name],
    );
    if (list) next[name] = list;
  }
  return next as unknown as PlayerView;
}

/**
 * Слои, которые не нужно пересчитывать при сборке вида вне срока синхронизации: сервер передаёт их
 * в `playerView` четвёртым аргументом, а `paceView` всё равно оставил бы базовые.
 * @returns прежние медленные слои из базы клиента или `undefined`, если пришёл срок или базы нет
 */
export function slowLayerReuse(
  base: PlayerView | null,
  sync: boolean,
): PlayerViewReuse | undefined {
  if (sync || base === null) return undefined;
  const reuse: Record<string, unknown> = {};
  for (const layer of SLOW_LAYERS) reuse[layer] = base.hexes[layer];
  return reuse as PlayerViewReuse;
}

/** Глубокое равенство значений вида, включая типизированные массивы. */
export function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return false;
    const a = left as unknown as ArrayLike<unknown>;
    const b = right as unknown as ArrayLike<unknown>;
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!Object.is(a[index], b[index])) return false;
    }
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!equalValue(left[index], right[index])) return false;
    }
    return true;
  }
  // Обход без Object.keys и замыканий: сравнение вызывается тысячи раз за тик, мусор здесь дорог.
  const a = left as Fields;
  const b = right as Fields;
  let count = 0;
  for (const key in a) {
    if (!(key in b) || !equalValue(a[key], b[key])) return false;
    count += 1;
  }
  // Ключей в `b` не больше, чем в `a`: иначе у `b` есть поле, которого нет в `a`.
  for (const key in b) {
    if (!(key in a)) return false;
    count -= 1;
  }
  return count === 0;
}

/** Можно ли строить дельту: тот же игрок и та же форма слоёв гексов. */
export function canBuildViewDelta(before: PlayerView, after: PlayerView): boolean {
  if (before.playerId !== after.playerId) return false;
  const layers = Object.keys(after.hexes) as HexLayer[];
  return (
    layers.length === Object.keys(before.hexes).length &&
    layers.every((layer) => before.hexes[layer]?.length === after.hexes[layer].length)
  );
}

/**
 * Патч записи: только изменившиеся поля `after` и `$unset` для исчезнувших; `undefined`, если
 * запись не изменилась. `key` — имя ключа, он попадает в патч первым (у записи `me` ключа нет).
 * Горячий путь (каждая запись каждый тик каждому игроку): ничего не выделяем, пока нет отличий.
 */
function diffFields(before: Fields, after: Fields, key: string | null): Patch | undefined {
  if (before === after) return undefined;
  let patch: Fields | undefined;
  for (const field in after) {
    if (equalValue(before[field], after[field])) continue;
    patch ??= key === null ? {} : { [key]: after[key] };
    patch[field] = after[field];
  }
  let unset: string[] | undefined;
  for (const field in before) {
    if (!(field in after)) (unset ??= []).push(field);
  }
  if (unset) {
    patch ??= key === null ? {} : { [key]: after[key] };
    patch.$unset = unset;
  }
  return patch;
}

/**
 * Дельта коллекции: слияние двух списков, отсортированных по числовому ключу, за один проход и без
 * Map/Set. Нарушенный порядок не ломает результат (запись уйдёт как удаление и добавление), но
 * раздувает дельту — тест-предохранитель держит порядок.
 */
function diffKeyed(
  before: readonly Fields[],
  after: readonly Fields[],
  key: string,
): KeyedDelta | undefined {
  let add: Fields[] | undefined;
  let patch: Patch[] | undefined;
  let removed: number[] | undefined;
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const old = before[i];
    const item = after[j];
    const oldKey = old === undefined ? Infinity : (old[key] as number);
    const newKey = item === undefined ? Infinity : (item[key] as number);
    if (old !== undefined && item !== undefined && oldKey === newKey) {
      const changed = diffFields(old, item, key);
      if (changed) (patch ??= []).push(changed);
      i += 1;
      j += 1;
    } else if (oldKey < newKey) {
      (removed ??= []).push(oldKey);
      i += 1;
    } else {
      (add ??= []).push(item as Fields);
      j += 1;
    }
  }
  return add || patch || removed
    ? { add: add ?? [], patch: patch ?? [], removed: removed ?? [] }
    : undefined;
}

/** Колонки изменений слоя: пары «зазор, значение» в порядке возрастания id. */
function diffHexLayer(before: HexArray, after: HexArray): number[] | undefined {
  // Слой не пересобирался (общий массив): менять нечему. Так медленные слои вне срока почти бесплатны.
  if (before === after) return undefined;
  const out: number[] = [];
  // Основная масса гексов не меняется: сравниваем по 4 байта сразу и разбираем поэлементно только
  // слово, где есть отличие.
  const perWord = WORD_BYTES / after.BYTES_PER_ELEMENT;
  const wordsBefore = wordsOf(before);
  const wordsAfter = wordsOf(after);
  const count = after.length;
  let last = 0;
  for (let id = 0; id < count; id += 1) {
    if (
      wordsBefore &&
      wordsAfter &&
      id % perWord === 0 &&
      wordsBefore[id / perWord] === wordsAfter[id / perWord]
    ) {
      id += perWord - 1;
      continue;
    }
    const value = after[id] as number;
    if (before[id] === value) continue;
    out.push(id - last, value);
    last = id;
  }
  return out.length > 0 ? out : undefined;
}

type HexArray = PlayerView['hexes'][HexLayer];
const WORD_BYTES = 4;

/** Слова по 4 байта над тем же буфером, если выравнивание позволяет; иначе `undefined`. */
function wordsOf(array: HexArray): Int32Array | undefined {
  const aligned = array.byteOffset % WORD_BYTES === 0 && array.byteLength % WORD_BYTES === 0;
  return aligned
    ? new Int32Array(array.buffer, array.byteOffset, array.byteLength / WORD_BYTES)
    : undefined;
}

/** Дельта между двумя видами одного игрока; `events` — события тика. */
export function buildViewDelta(
  before: PlayerView,
  after: PlayerView,
  events: readonly GameEvent[],
): DeltaMessage {
  const hexes: HexColumns = {};
  for (const layer of Object.keys(after.hexes) as HexLayer[]) {
    const columns = diffHexLayer(before.hexes[layer], after.hexes[layer]);
    if (columns) hexes[layer] = columns;
  }
  const keyed: ViewDelta['keyed'] = {};
  for (const name of KEYED_NAMES) {
    const delta = diffKeyed(
      (before[name] ?? []) as unknown as Fields[],
      (after[name] ?? []) as unknown as Fields[],
      KEYED[name],
    );
    if (delta) keyed[name] = delta;
  }
  const records: Partial<Record<RecordName, Patch>> = {};
  for (const name of RECORDS) {
    const changed = diffFields(before[name] as Fields, after[name] as Fields, null);
    if (changed) records[name] = changed;
  }
  const whole: Fields = {};
  const unset: string[] = [];
  const beforeFields = before as unknown as Fields;
  const afterFields = after as unknown as Fields;
  for (const key of new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)])) {
    if (SPECIAL.has(key)) continue;
    if (!(key in afterFields)) unset.push(key);
    else if (!equalValue(beforeFields[key], afterFields[key])) whole[key] = afterFields[key];
  }
  return {
    t: 'delta',
    baseTick: before.tick,
    tick: after.tick,
    d: {
      hexes,
      keyed,
      ...(Object.keys(records).length > 0 ? { records } : {}),
      ...(Object.keys(whole).length > 0 ? { whole } : {}),
      ...(unset.length > 0 ? { unset } : {}),
      events,
    },
  };
}

function applyHexColumns(view: PlayerView, columns: HexColumns): PlayerView['hexes'] {
  // Копируем лишь слои с изменениями: остальные делятся с прошлым видом, иначе каждый тик
  // аллоцирует все слои и душит GC.
  const hexes: Record<string, ArrayLike<number>> = { ...view.hexes };
  for (const layer of Object.keys(columns) as HexLayer[]) {
    const pairs = columns[layer];
    if (!pairs) continue;
    const copy = view.hexes[layer].slice() as unknown as number[];
    let id = 0;
    for (let index = 0; index < pairs.length; index += 2) {
      id += pairs[index] as number;
      copy[id] = pairs[index + 1] as number;
    }
    hexes[layer] = copy;
  }
  return hexes as unknown as PlayerView['hexes'];
}

function applyKeyed(current: readonly Fields[], delta: KeyedDelta, key: string): Fields[] {
  const removed = new Set<unknown>(delta.removed);
  const patches = new Map<unknown, Patch>(delta.patch.map((patch) => [patch[key], patch]));
  const result: Fields[] = [];
  for (const item of current) {
    if (removed.has(item[key])) continue;
    const patch = patches.get(item[key]);
    result.push(patch ? applyPatch(item, patch) : item);
  }
  result.push(...(delta.add as Fields[]));
  return result.sort((left, right) => (left[key] as number) - (right[key] as number));
}

function applyPatch(item: Fields, patch: Patch): Fields {
  const next: Fields = { ...item, ...patch };
  Reflect.deleteProperty(next, '$unset');
  for (const field of patch.$unset ?? []) Reflect.deleteProperty(next, field);
  return next;
}

/** Применяет дельту к виду и возвращает новый вид; исходный не меняется. */
export function applyViewDelta(view: PlayerView, message: DeltaMessage): PlayerView {
  const { d } = message;
  const next: Fields = without(
    { ...(view as unknown as Fields), ...(d.whole ?? {}) },
    d.unset ?? [],
  );
  for (const name of KEYED_NAMES) {
    const delta = d.keyed[name];
    if (delta) {
      next[name] = applyKeyed((view[name] ?? []) as unknown as Fields[], delta, KEYED[name]);
    }
  }
  for (const name of RECORDS) {
    const patch = d.records?.[name];
    if (patch) next[name] = applyPatch(view[name] as Fields, patch);
  }
  next.tick = message.tick;
  next.hexes = applyHexColumns(view, d.hexes);
  return next as unknown as PlayerView;
}
