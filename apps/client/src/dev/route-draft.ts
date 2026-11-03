// Маршрут по точкам (07-controls.md, «Маршрут по точкам»): Shift+ПКМ копит промежуточные гексы,
// обычный ПКМ отправляет приказ с ними. Черновик живёт в клиенте; путь и время для показа
// считает sim (previewPath), здесь — только накопление и ограничение запросов.
import { MAX_VIA_POINTS, type PathPreview } from '@hexfront/sim';

/** Что рисует слой: гексы пути, время в пути, враг на пути и сами точки маршрута. */
export interface RouteView {
  readonly path: readonly number[];
  readonly ticks: number;
  readonly enemyOnPath: boolean;
  readonly waypoints: readonly number[];
}

export interface RouteDeps {
  /** Выбранные свои отряды: пустой список — маршрут не строится. */
  unitIds(): readonly number[];
  request(requestId: number, unitIds: readonly number[], to: number, via: readonly number[]): void;
  show(route: RouteView | null): void;
  /** Следующий кадр: запросы не чаще раза за кадр. */
  schedule(run: () => void): void;
}

export interface RouteDraft {
  /** Shift+ПКМ: добавляет точку (подряд одинаковые и сверх лимита отбрасываются). */
  add(hex: number): void;
  /** Курсор над гексом (null — ушёл): обновляет подсказку пути. */
  hover(hex: number | null): void;
  /** Точки для приказа; черновик очищается. */
  take(): readonly number[];
  clear(): void;
  /** Ответ воркера на запрос подсказки. */
  reply(requestId: number, preview: PathPreview | null): void;
  readonly points: readonly number[];
}

/** Создаёт черновик маршрута; ответы previewPath приходят в reply с тем же requestId. */
export function createRouteDraft(d: RouteDeps): RouteDraft {
  let points: number[] = [];
  let owners = '';
  let hovered: number | null = null;
  let lastKey = '';
  let nextId = 0;
  let waiting = 0;
  let queued = false;
  let waypoints: readonly number[] = [];

  const flush = (): void => {
    queued = false;
    const ids = d.unitIds();
    // Конец пути — гекс под курсором, а без него — последняя точка.
    const to = hovered ?? points.at(-1) ?? null;
    const via = hovered === null ? points.slice(0, -1) : points;
    if (ids.length === 0 || to === null) {
      lastKey = '';
      waiting = 0;
      return d.show(null);
    }
    const key = `${ids.join(',')}>${via.join(',')}>${to}`;
    if (key === lastKey) return;
    lastKey = key;
    nextId += 1;
    waiting = nextId;
    waypoints = [...via, to];
    d.request(nextId, ids, to, via);
  };
  const touch = (): void => {
    if (queued) return;
    queued = true;
    d.schedule(flush);
  };
  const clear = (): void => {
    points = [];
    owners = '';
    waypoints = [];
    lastKey = '';
    waiting = 0;
    d.show(null);
  };

  return {
    add(hex) {
      const ids = d.unitIds().join(',');
      if (ids === '') return;
      if (ids !== owners) points = [];
      owners = ids;
      if (points.at(-1) === hex || points.length >= MAX_VIA_POINTS) return;
      points.push(hex);
      touch();
    },
    hover(hex) {
      if (hex === hovered) return;
      hovered = hex;
      if (hex === null && points.length === 0) return clear();
      touch();
    },
    take() {
      const via = [...points];
      clear();
      return via;
    },
    clear,
    reply(requestId, preview) {
      if (requestId !== waiting) return;
      if (!preview) return d.show(null);
      d.show({
        path: preview.path,
        ticks: preview.ticks,
        enemyOnPath: preview.enemyOnPath,
        waypoints,
      });
    },
    get points() {
      return points;
    },
  };
}
