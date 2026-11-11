// Геометрия «стран» главного меню: кластеры гексов на той же сетке, что и игровая карта
// (плоские гексы, нечётные столбцы сдвинуты вниз). Радиус гекса = 1; масштаб задаёт viewBox.

/** Гекс в столбцах и рядах («odd-q»). */
export type Cell = readonly [number, number];

const SQRT3 = Math.sqrt(3);

/** Соседи по рёбрам 0..5: юго-восток, юг, юго-запад, северо-запад, север, северо-восток. */
const DIRS_EVEN: readonly Cell[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const DIRS_ODD: readonly Cell[] = [
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

function neighbor(cell: Cell, edge: number): Cell {
  const dirs = cell[0] % 2 === 0 ? DIRS_EVEN : DIRS_ODD;
  const [dx, dy] = dirs[edge] as Cell;
  return [cell[0] + dx, cell[1] + dy];
}

/** Центр гекса в единицах радиуса. */
export function cellCenter(cell: Cell): { readonly x: number; readonly y: number } {
  return { x: 1.5 * cell[0], y: SQRT3 * (cell[1] + (cell[0] % 2 === 0 ? 0 : 0.5)) };
}

/** Гекс и шесть его соседей. */
export function flower(center: Cell): Cell[] {
  return [center, ...[0, 1, 2, 3, 4, 5].map((edge) => neighbor(center, edge))];
}

/** Страна из цветка и двух гексов по краям: вдоль столбца (высокая) или вдоль ряда (широкая). */
export function country(center: Cell, wide: boolean): Cell[] {
  const extra: Cell[] = wide
    ? [
        [center[0] - 2, center[1]],
        [center[0] + 2, center[1]],
      ]
    : [
        [center[0], center[1] - 2],
        [center[0], center[1] + 2],
      ];
  return [...flower(center), ...extra];
}

function corner(cell: Cell, index: number): string {
  const { x, y } = cellCenter(cell);
  const angle = (Math.PI / 3) * index;
  return `${(x + Math.cos(angle)).toFixed(3)} ${(y + Math.sin(angle)).toFixed(3)}`;
}

export interface TerritoryShape {
  /** Многоугольники гексов для заливки. */
  readonly polygons: readonly string[];
  /** Внешняя граница страны одним путём: рёбра, за которыми нет гекса той же страны. */
  readonly border: string;
  /** Центр масс: сюда ставится подпись. */
  readonly label: { readonly x: number; readonly y: number };
}

export function shapeOf(cells: readonly Cell[]): TerritoryShape {
  const own = new Set(cells.map((c) => `${c[0]},${c[1]}`));
  const polygons = cells.map((cell) =>
    [0, 1, 2, 3, 4, 5].map((i) => corner(cell, i).replace(' ', ',')).join(' '),
  );
  const segments: string[] = [];
  for (const cell of cells) {
    for (let edge = 0; edge < 6; edge += 1) {
      const next = neighbor(cell, edge);
      if (!own.has(`${next[0]},${next[1]}`)) {
        segments.push(`M${corner(cell, edge)}L${corner(cell, (edge + 1) % 6)}`);
      }
    }
  }
  const centers = cells.map(cellCenter);
  const label = {
    x: centers.reduce((sum, p) => sum + p.x, 0) / centers.length,
    y: centers.reduce((sum, p) => sum + p.y, 0) / centers.length,
  };
  return { polygons, border: segments.join(''), label };
}

export type TerritoryId = 'online' | 'bots' | 'friends' | 'tutorial' | 'profile';

export interface LayoutItem {
  readonly id: TerritoryId;
  readonly cells: readonly Cell[];
  /** Размер названия в радиусах гекса; подпись вдвое мельче. */
  readonly size: number;
}

export interface MenuLayout {
  readonly items: readonly LayoutItem[];
}

/** Вертикальная раскладка для телефона в портрете: три ряда, семь столбцов. */
export const PORTRAIT: MenuLayout = {
  items: [
    { id: 'online', cells: country([3, 2], false), size: 0.8 },
    { id: 'bots', cells: flower([1, 6]), size: 0.5 },
    { id: 'friends', cells: flower([5, 6]), size: 0.5 },
    { id: 'tutorial', cells: flower([1, 10]), size: 0.5 },
    { id: 'profile', cells: flower([5, 10]), size: 0.5 },
  ],
};

/** Широкая раскладка для компьютера и телефона в ландшафте. */
export const LANDSCAPE: MenuLayout = {
  items: [
    { id: 'online', cells: country([7, 2], true), size: 0.8 },
    { id: 'bots', cells: flower([2, 5]), size: 0.5 },
    { id: 'friends', cells: flower([12, 5]), size: 0.5 },
    { id: 'tutorial', cells: flower([7, 6]), size: 0.5 },
    {
      id: 'profile',
      cells: [
        [12, 1],
        [13, 1],
        [12, 2],
        [13, 2],
      ],
      size: 0.5,
    },
  ],
};

/** Полоса для телефона в ландшафте: экран низкий и очень широкий, страны идут в один ряд. */
export const STRIP: MenuLayout = {
  items: [
    { id: 'tutorial', cells: flower([1, 1]), size: 0.5 },
    { id: 'bots', cells: flower([4, 1]), size: 0.5 },
    { id: 'online', cells: country([8, 1], true), size: 0.8 },
    { id: 'friends', cells: flower([12, 1]), size: 0.5 },
    { id: 'profile', cells: flower([15, 1]), size: 0.5 },
  ],
};

/** Рамка раскладки в единицах радиуса: viewBox для SVG. */
export function boundsOf(layout: MenuLayout): { x: number; y: number; w: number; h: number } {
  const points = layout.items.flatMap((item) => item.cells.map(cellCenter));
  const minX = Math.min(...points.map((p) => p.x)) - 1.2;
  const maxX = Math.max(...points.map((p) => p.x)) + 1.2;
  const minY = Math.min(...points.map((p) => p.y)) - SQRT3 / 2 - 0.2;
  const maxY = Math.max(...points.map((p) => p.y)) + SQRT3 / 2 + 0.2;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
