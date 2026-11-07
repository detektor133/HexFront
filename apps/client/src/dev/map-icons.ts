// Знаки на карте: склад — коробка, укрепление — щит, город — силуэт домов, благоустройство —
// шевроны, столица — звезда (контуры в стиле Tabler, как на кнопках строительства). Без дисков:
// иконка цвета владельца с белой обводкой.
//
// Всё рисует видеокарта: контуры один раз превращаются в атлас полей расстояний (SDF), а все
// иконки карты — один меш из квадратов, край которых шейдер сглаживает по экранному размеру.
// Поэтому иконка одинаково чёткая на любом зуме, а память не растёт: буфер вершин переиспользуется.
import {
  BufferImageSource,
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  Mesh,
  Shader,
  Texture,
} from 'pixi.js';

import type { Point } from '../render/hex-geometry.ts';
import { signedDistanceField } from '../render/icon-sdf.ts';

export type MapIconKind = 'city' | 'capital' | 'fort' | 'depot' | 'port' | 'improvement' | 'dot';

export interface MapIcon {
  readonly kind: MapIconKind;
  readonly at: Point;
  /** Цвет иконки — цвет владельца; белая обводка рисуется под ней. */
  readonly color: string;
  /** Сторона квадрата иконки, мировые единицы. */
  readonly size: number;
}

/** Сторона иконки в радиусах знака: контур занимает ~3/4 своей рамки 24×24. */
export const ICON_FIT = 2.2;

/** Контуры в рамке 24×24. */
const ICON_PATHS: Readonly<Record<MapIconKind, readonly string[]>> = {
  city: [
    'M3 21v-8h5v8',
    'M8 21v-17h8v17',
    'M16 21v-10h5v10',
    'M2 21h20',
    'M12 9v.01',
    'M12 14v.01',
  ],
  fort: ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
  depot: [
    'M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5',
    'M12 12l8 -4.5',
    'M12 12l0 9',
    'M12 12l-8 -4.5',
    'M16 5.25l-8 4.5',
  ],
  // Порт — склад у воды: якорь вместо ящика.
  port: [
    'M12 6m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0',
    'M12 8.2v13',
    'M8 12h8',
    'M4.5 15.5a7.5 7.5 0 0 0 15 0',
  ],
  capital: ['M12 2l2.9 6.6l7.1 0.7l-5.4 4.7l1.6 7l-6.2 -3.7l-6.2 3.7l1.6 -7l-5.4 -4.7l7.1 -0.7z'],
  improvement: ['M7 11l5 -5l5 5', 'M7 17l5 -5l5 5'],
  dot: ['M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0'],
};

/** Сплошные фигуры: закрашиваются, а не только обводятся. */
const FILLED: ReadonlySet<MapIconKind> = new Set(['capital', 'dot']);
const KINDS = Object.keys(ICON_PATHS) as MapIconKind[];

const STROKE = 2.6;
/** Толщина белой обводки, единицы рамки (в каждую сторону — половина). */
const OUTLINE = 2.8;
/** Клетка атласа, пикселей; растр для поля строится вдвое крупнее ради точности края. */
const CELL = 128;
const RASTER = CELL * 2;
/** До какого расстояния от края (пикселей клетки) поле меняется. */
const SPREAD = 16;

/** Атлас полей расстояний: одна клетка на вид, канал R, 128 — край фигуры. */
function buildAtlas(): Uint8Array {
  const width = CELL * KINDS.length;
  const rgba = new Uint8Array(width * CELL * 4);
  const canvas = document.createElement('canvas');
  canvas.width = RASTER;
  canvas.height = RASTER;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Без растра (тестовая среда с поддельным canvas) атлас остаётся пустым.
  if (!ctx || typeof ctx.getImageData !== 'function') return rgba;
  KINDS.forEach((kind, index) => {
    ctx.clearRect(0, 0, RASTER, RASTER);
    ctx.save();
    ctx.scale(RASTER / 24, RASTER / 24);
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineWidth = STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of ICON_PATHS[kind]) {
      const path = new Path2D(d);
      if (FILLED.has(kind)) ctx.fill(path);
      ctx.stroke(path);
    }
    ctx.restore();
    const pixels = ctx.getImageData(0, 0, RASTER, RASTER).data;
    const inside = new Uint8Array(RASTER * RASTER);
    for (let i = 0; i < inside.length; i += 1) inside[i] = (pixels[i * 4 + 3] ?? 0) > 127 ? 1 : 0;
    const field = signedDistanceField(inside, RASTER, SPREAD, 2);
    for (let y = 0; y < CELL; y += 1) {
      for (let x = 0; x < CELL; x += 1) {
        const o = (y * width + index * CELL + x) * 4;
        rgba[o] = field[y * CELL + x] ?? 0;
        rgba[o + 3] = 255;
      }
    }
  });
  return rgba;
}

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUv;
in vec4 aColor;
out vec2 vUv;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}`;

// aColor.a: 1 — цветная иконка, 0 — белая обводка (та же фигура, раздутая на GROW).
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uAtlas;
uniform float uGrow;
void main() {
  float sd = texture(uAtlas, vUv).r;
  float w = max(fwidth(sd), 0.0005) * 0.75;
  float edge = vColor.a > 0.5 ? 0.5 : 0.5 - uGrow;
  float cover = smoothstep(edge - w, edge + w, sd);
  vec3 rgb = vColor.a > 0.5 ? vColor.rgb : vec3(1.0);
  finalColor = vec4(rgb * cover, cover);
}`;

const FLOATS_PER_VERTEX = 8;
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 4;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

export interface MapIconLayer {
  readonly container: Container;
  /** Расставляет иконки: обводки идут первыми, затем цветные фигуры. */
  sync(icons: readonly MapIcon[]): void;
  destroy(): void;
}

function headlessLayer(): MapIconLayer {
  return { container: new Container(), sync: () => undefined, destroy: () => undefined };
}

function quadIndices(quads: number): Uint32Array {
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q += 1) {
    const v = q * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
  }
  return indices;
}

/** Без DOM (юнит-тесты в node) шейдер не компилируется — слой пустой. */
export function createMapIconLayer(): MapIconLayer {
  if (typeof document === 'undefined') return headlessLayer();
  const atlasWidth = CELL * KINDS.length;
  const source = new BufferImageSource({
    resource: buildAtlas(),
    width: atlasWidth,
    height: CELL,
    format: 'rgba8unorm',
    scaleMode: 'linear',
    alphaMode: 'no-premultiply-alpha',
  });
  const texture = new Texture({ source });
  let capacity = 64;
  let vertices = new Float32Array(capacity * FLOATS_PER_QUAD);
  const vertexBuffer = new Buffer({
    data: vertices,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  const indexBuffer = new Buffer({
    data: quadIndices(capacity),
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  const stride = FLOATS_PER_VERTEX * 4;
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: vertexBuffer, format: 'float32x2', stride, offset: 0 },
      aUv: { buffer: vertexBuffer, format: 'float32x2', stride, offset: 8 },
      aColor: { buffer: vertexBuffer, format: 'float32x4', stride, offset: 16 },
    },
    indexBuffer,
  });
  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      uAtlas: texture.source,
      params: {
        uGrow: { value: ((OUTLINE / 2) * (CELL / 24)) / (2 * SPREAD), type: 'f32' },
      },
    },
  });
  const mesh = new Mesh({ geometry, shader });
  const container = new Container();
  container.addChild(mesh);

  const writeQuad = (slot: number, icon: MapIcon, cell: number, outline: boolean): void => {
    const half = icon.size / 2;
    const [r, g, b] = outline ? [1, 1, 1] : channels(icon.color);
    const a = outline ? 0 : 1;
    // Полпикселя внутрь клетки: соседние клетки атласа не просачиваются при линейной выборке.
    const pad = 0.5 / atlasWidth;
    const u0 = (cell * CELL) / atlasWidth + pad;
    const u1 = ((cell + 1) * CELL) / atlasWidth - pad;
    const v0 = 0.5 / CELL;
    const v1 = 1 - 0.5 / CELL;
    const corners = [
      [icon.at.x - half, icon.at.y - half, u0, v0],
      [icon.at.x + half, icon.at.y - half, u1, v0],
      [icon.at.x + half, icon.at.y + half, u1, v1],
      [icon.at.x - half, icon.at.y + half, u0, v1],
    ] as const;
    let o = slot * FLOATS_PER_QUAD;
    for (const [x, y, u, v] of corners) {
      vertices.set([x, y, u, v, r, g, b, a], o);
      o += FLOATS_PER_VERTEX;
    }
  };

  const grow = (needed: number): void => {
    while (capacity < needed) capacity *= 2;
    vertices = new Float32Array(capacity * FLOATS_PER_QUAD);
    vertexBuffer.data = vertices;
    indexBuffer.data = quadIndices(capacity);
  };

  return {
    container,
    sync(icons) {
      const total = icons.length * 2;
      if (total > capacity) grow(total);
      else vertices.fill(0, total * FLOATS_PER_QUAD);
      // Сначала все обводки, затем все цветные иконки: соседние знаки не затирают друг друга.
      icons.forEach((icon, i) => writeQuad(i, icon, KINDS.indexOf(icon.kind), true));
      icons.forEach((icon, i) =>
        writeQuad(icons.length + i, icon, KINDS.indexOf(icon.kind), false),
      );
      vertexBuffer.update();
      container.visible = total > 0;
    },
    destroy() {
      container.destroy({ children: true, context: true });
      geometry.destroy(true);
      texture.destroy(true);
    },
  };
}
