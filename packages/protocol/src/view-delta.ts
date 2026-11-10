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
import type { GameEvent, PlayerView } from '@hexfront/sim';

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

const SLOW_LAYERS: readonly HexLayer[] = ['pop', 'growth'];
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

/** Копия записи без перечисленных полей. */
function without(item: Fields, names: readonly string[]): Fields {
  const drop = new Set(names);
  return Object.fromEntries(Object.entries(item).filter(([key]) => !drop.has(key)));
}

function pickFields(from: Fields, to: Fields, names: readonly string[]): Fields {
  const missing = names.filter((name) => !(name in from));
  const result = without(to, missing);
  for (const name of names) if (name in from) result[name] = from[name];
  return result;
}

function paceList(
  base: readonly Fields[] | undefined,
  list: readonly Fields[] | undefined,
  names: readonly string[],
): Fields[] | undefined {
  if (!list || !base) return list as Fields[] | undefined;
  const known = new Map<unknown, Fields>(base.map((item) => [item.id, item]));
  return list.map((item) => {
    const old = known.get(item.id);
    return old ? pickFields(old, item, names) : item;
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
    return left.every((value, index) => equalValue(value, right[index]));
  }
  const a = left as Fields;
  const b = right as Fields;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && equalValue(a[key], b[key]))
  );
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

/** Только изменившиеся поля `after` относительно `before` и поля, которых больше нет. */
function diffFields(before: Fields, after: Fields): { set: Fields; unset: string[] } {
  const set: Fields = {};
  const unset: string[] = [];
  for (const key of Object.keys(after)) {
    if (!equalValue(before[key], after[key])) set[key] = after[key];
  }
  for (const key of Object.keys(before)) if (!(key in after)) unset.push(key);
  return { set, unset };
}

function diffKeyed(
  before: readonly Fields[],
  after: readonly Fields[],
  key: string,
): KeyedDelta | undefined {
  const known = new Map<unknown, Fields>(before.map((item) => [item[key], item]));
  const add: Fields[] = [];
  const patch: Patch[] = [];
  const seen = new Set<unknown>();
  for (const item of after) {
    seen.add(item[key]);
    const old = known.get(item[key]);
    if (old === undefined) {
      add.push(item);
      continue;
    }
    const { set, unset } = diffFields(old, item);
    if (unset.length > 0 || Object.keys(set).length > 0) {
      patch.push({ [key]: item[key], ...set, ...(unset.length > 0 ? { $unset: unset } : {}) });
    }
  }
  const removed = before.filter((item) => !seen.has(item[key])).map((item) => item[key] as number);
  return add.length > 0 || patch.length > 0 || removed.length > 0
    ? { add, patch, removed }
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
    const { set, unset } = diffFields(before[name] as Fields, after[name] as Fields);
    if (unset.length > 0 || Object.keys(set).length > 0) {
      records[name] = { ...set, ...(unset.length > 0 ? { $unset: unset } : {}) };
    }
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
  return without({ ...item, ...patch }, ['$unset', ...(patch.$unset ?? [])]);
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
