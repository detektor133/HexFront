// Рельеф на GPU: код местности каждого гекса лежит в текстуре, заливка, плавные переходы между
// биомами, берег, сетка и узоры (лес, холмы, горы, пустыня, рябь воды) считаются во фрагментном
// шейдере. Узоры — SDF с экранной толщиной линии: при зуме не нужна перетесселяция геометрии.
import { BufferImageSource, Container, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';

import { hexFromId, hexId, inBounds, neighbor, type Hex, type MapStatic } from '@hexfront/sim';

import type { DetailLevel } from './camera.ts';
import { mapBounds } from './hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const { map: M } = tokens;
const MODE_BASE = 0;
const MODE_OVER = 1;

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D uData;
uniform sampler2D uColors;
uniform vec2 uMap;
uniform float uR;
uniform float uPx;
uniform float uPattern;
uniform float uGrid;
uniform float uRiver;
uniform vec3 uRiverColor;
uniform vec2 uGridStyle;
uniform float uMode;

const float SQRT3 = 1.7320508;
const ivec2 EDGE_CORNERS[6] = ivec2[6](ivec2(0, 1), ivec2(5, 0), ivec2(4, 5), ivec2(3, 4), ivec2(2, 3), ivec2(1, 2));
const ivec2 DIRS[6] = ivec2[6](ivec2(1, 0), ivec2(1, -1), ivec2(0, -1), ivec2(-1, 0), ivec2(-1, 1), ivec2(0, 1));

ivec2 toOffset(ivec2 ax) {
  return ivec2(ax.x, ax.y + (ax.x + (ax.x & 1)) / 2);
}

bool inMap(ivec2 o) {
  return o.x >= 0 && o.y >= 0 && o.x < int(uMap.x) && o.y < int(uMap.y);
}

// За краем карты — море: край не рисуется берегом.
int terrainAt(ivec2 ax) {
  ivec2 o = toOffset(ax);
  if (!inMap(o)) return 0;
  return int(texelFetch(uData, o, 0).r * 255.0 + 0.5);
}

vec3 fillOf(int t) { return texelFetch(uColors, ivec2(t, 0), 0).rgb; }
vec3 inkOf(int t) { return texelFetch(uColors, ivec2(t, 1), 0).rgb; }

// Тот же хеш, что hexNoise в terrain-layer.ts: узор не меняется при смене рендера.
float hexNoise(ivec2 qr, int salt) {
  uint h = uint(qr.x) * 0x27d4eb2du ^ uint(qr.y) * 0x165667b1u ^ uint(salt) * 0x9e3779b9u;
  h = (h ^ (h >> 15)) * 0x85ebca6bu;
  h = (h ^ (h >> 13)) * 0xc2b2ae35u;
  return float(h ^ (h >> 16)) / 4294967296.0;
}

vec2 corner(int k) {
  float a = radians(60.0 * float(k));
  return uR * vec2(cos(a), sin(a));
}

float edgeDist(vec2 p, int d, float apothem) {
  float ang = radians(30.0 - 60.0 * float(d));
  return apothem - dot(p, vec2(cos(ang), sin(ang)));
}

// Покрытие пикселя по знаковому расстоянию d (в долях радиуса гекса).
float cover(float d) {
  return clamp(0.5 - d / (uPx / uR), 0.0, 1.0);
}

void over(inout vec4 acc, vec3 c, float a) {
  acc = vec4(c * a, a) + acc * (1.0 - a);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float triDist(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a; vec2 e1 = c - b; vec2 e2 = a - c;
  vec2 v0 = p - a; vec2 v1 = p - b; vec2 v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// Лес: три плоские кроны.
void forest(inout vec4 acc, vec2 q, vec3 ink) {
  vec2 centers[3] = vec2[3](vec2(0.0, -0.18), vec2(-0.24, 0.135), vec2(0.24, 0.135));
  for (int i = 0; i < 3; i++) over(acc, ink, cover(length(q - centers[i]) - 0.17));
}

// Холмы: две дуги-«горба» с лёгкой заливкой под дугой.
void hills(inout vec4 acc, vec2 q, vec3 ink, float hw) {
  float w = 0.28;
  float h = 0.3;
  for (int i = 0; i < 2; i++) {
    vec2 o = i == 0 ? vec2(-0.2464, -0.05) : vec2(0.2464, 0.2);
    float lx = q.x - o.x;
    float yy = o.y - h * (1.0 - (lx / w) * (lx / w));
    float slope = 2.0 * h * lx / (w * w);
    float d = abs(lx) <= w
      ? abs(q.y - yy) / sqrt(1.0 + slope * slope)
      : min(length(q - vec2(o.x - w, o.y)), length(q - vec2(o.x + w, o.y)));
    if (abs(lx) <= w && q.y > yy && q.y < o.y) over(acc, ink, 0.16);
    over(acc, ink, cover(d - hw));
  }
}

// Горы: пик, светлая и тёмная грани, штриховка теневого склона.
void mountain(inout vec4 acc, vec2 q, vec3 ink, float hw) {
  float w = 0.48;
  vec2 peak = vec2(0.0, -0.42);
  vec2 left = vec2(-w, 0.3);
  vec2 right = vec2(w, 0.3);
  vec2 mid = vec2(0.0, 0.3);
  over(acc, vec3(1.0), 0.32 * cover(triDist(q, left, peak, mid)));
  over(acc, ink, 0.26 * cover(triDist(q, peak, right, mid)));
  float d = min(segDist(q, left, peak), segDist(q, peak, right));
  for (int i = 1; i <= 3; i++) {
    float t = float(i) / 4.0;
    vec2 a = vec2(w * t, peak.y + (0.3 - peak.y) * t);
    d = min(d, segDist(q, a, vec2(a.x - w * 0.18, 0.3)));
  }
  over(acc, ink, cover(d - hw));
}

// Пустыня: две строки ряби.
void desert(inout vec4 acc, vec2 q, vec3 ink, float hw) {
  float half_ = 0.3;
  for (int i = 0; i < 2; i++) {
    float dy = i == 0 ? -0.5 : 0.5;
    float y0 = dy * 0.48;
    float x0 = -half_ + dy * half_ * 0.4;
    float lx = q.x - x0;
    float len = half_ * 2.0;
    if (lx < 0.0 || lx > len) continue;
    float yy = y0 - 0.08 * sin(6.2831853 * lx / len);
    float slope = -0.08 * 6.2831853 / len * cos(6.2831853 * lx / len);
    over(acc, ink, cover(abs(q.y - yy) / sqrt(1.0 + slope * slope) - hw));
  }
}

void main() {
  float q = (2.0 / 3.0) * vWorld.x / uR;
  float r = (-1.0 / 3.0 * vWorld.x + SQRT3 / 3.0 * vWorld.y) / uR;
  float s = -q - r;
  float rq = floor(q + 0.5);
  float rr = floor(r + 0.5);
  float rs = floor(s + 0.5);
  float dq = abs(rq - q);
  float dr = abs(rr - r);
  float ds = abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  ivec2 ax = ivec2(int(rq), int(rr));
  if (!inMap(toOffset(ax))) discard;
  vec4 cell = texelFetch(uData, toOffset(ax), 0);
  int t = int(cell.r * 255.0 + 0.5);
  vec2 p = vWorld - vec2(uR * 1.5 * rq, uR * SQRT3 * (rr + rq * 0.5));
  float apothem = uR * SQRT3 * 0.5;

  if (uMode < 0.5) {
    vec3 col = fillOf(t);
    float gridCover = 0.0;
    if (uGrid > 0.5) {
      for (int d = 0; d < 6; d++) {
        float dist = edgeDist(p, d, apothem);
        gridCover = max(gridCover, clamp((uGridStyle.x - dist) / uPx + 0.5, 0.0, 1.0));
      }
    }
    // Реки: грани гекса (G) и «спицы» из его углов по граням соседей (B) — линия не рвётся в вершинах.
    int edges = int(cell.g * 255.0 + 0.5);
    int spokes = int(cell.b * 255.0 + 0.5);
    float riverD = 1e9;
    for (int d = 0; d < 6; d++) {
      if (((edges >> d) & 1) == 1) riverD = min(riverD, segDist(p, corner(EDGE_CORNERS[d].x), corner(EDGE_CORNERS[d].y)));
      if (((spokes >> d) & 1) == 1) {
        vec2 a = corner(d);
        riverD = min(riverD, segDist(p, a, a * 2.0));
      }
    }
    col = mix(col, vec3(1.0), uGridStyle.y * gridCover);
    col = mix(col, uRiverColor, clamp((uRiver * 0.5 - riverD) / uPx + 0.5, 0.0, 1.0));
    finalColor = vec4(col, 1.0);
    return;
  }

  vec4 acc = vec4(0.0);
  float hw = uPattern * uPx / uR * 0.5;
  vec2 j = vec2(hexNoise(ax, 1) - 0.5, hexNoise(ax, 2) - 0.5) * 0.24;
  vec2 pl = p / uR - j;
  if (t == 2) forest(acc, pl, inkOf(2));
  else if (t == 3) hills(acc, pl, inkOf(3), hw);
  else if (t == 4) mountain(acc, pl, inkOf(4), hw);
  else if (t == 5) desert(acc, pl, inkOf(5), hw);

  float coast = 0.0;
  for (int d = 0; d < 6; d++) {
    float dist = edgeDist(p, d, apothem);
    int nt = terrainAt(ax + DIRS[d]);
    if ((nt == 0) != (t == 0)) {
      coast = max(coast, clamp((uPx * 0.5 - dist) / uPx + 0.5, 0.0, 1.0));
    }
  }
  if (coast > 0.0) over(acc, inkOf(0), coast);
  if (acc.a <= 0.0) discard;
  finalColor = acc;
}`;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export interface TerrainGpu {
  /** Заливка, переходы биомов, берег-подсветка и сетка — под территорией. */
  readonly base: Container;
  /** Узоры и береговая линия — над территорией. */
  readonly over: Container;
  /** Толщины линий — экранные px; сетка видна с уровня M.hexGridVisibleFromZoom. */
  setScale(scale: number, level: DetailLevel): void;
  destroy(): void;
}

function headlessTerrain(): TerrainGpu {
  return {
    base: new Container(),
    over: new Container(),
    setScale: () => undefined,
    destroy: () => undefined,
  };
}

const CORNER_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 5],
  [5, 4],
  [4, 3],
  [3, 2],
  [2, 1],
];

// Есть ли река на грани d гекса: бит хранится у гекса с направлением 0–2, иначе — у соседа.
function riverOnEdge(map: MapStatic, hex: Hex, d: number): boolean {
  if (!inBounds(hex, map.width, map.height)) return false;
  if (d < 3) return ((map.rivers[hexId(hex, map.width)] ?? 0) & (1 << d)) !== 0;
  const other = neighbor(hex, d as 0 | 1 | 2 | 3 | 4 | 5);
  if (!inBounds(other, map.width, map.height)) return false;
  return ((map.rivers[hexId(other, map.width)] ?? 0) & (1 << (d - 3))) !== 0;
}

/**
 * Маски рек гекса: грани (бит d) и «спицы» из углов (бит k) — грани между двумя соседями,
 * которые выходят из угла гекса наружу.
 * @returns [маска граней, маска спиц]
 */
export function riverMasks(map: MapStatic, hex: Hex): readonly [number, number] {
  let edges = 0;
  let spokes = 0;
  for (let d = 0; d < 6; d += 1) if (riverOnEdge(map, hex, d)) edges |= 1 << d;
  CORNER_EDGES.forEach(([a, b], k) => {
    const first = neighbor(hex, a as 0 | 1 | 2 | 3 | 4 | 5);
    const second = neighbor(hex, b as 0 | 1 | 2 | 3 | 4 | 5);
    for (let e = 0; e < 6; e += 1) {
      const n = neighbor(first, e as 0 | 1 | 2 | 3 | 4 | 5);
      if (n.q === second.q && n.r === second.r) {
        if (riverOnEdge(map, first, e)) spokes |= 1 << k;
        break;
      }
    }
  });
  return [edges, spokes];
}

export function createTerrainGpu(map: MapStatic, radius: number): TerrainGpu {
  if (typeof document === 'undefined') return headlessTerrain();
  const data = new Uint8Array(map.width * map.height * 4);
  map.terrain.forEach((code, id) => {
    const [edges, spokes] = riverMasks(map, hexFromId(id, map.width));
    data[id * 4] = code;
    data[id * 4 + 1] = edges;
    data[id * 4 + 2] = spokes;
    data[id * 4 + 3] = 255;
  });
  const dataSource = new BufferImageSource({
    resource: data,
    width: map.width,
    height: map.height,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const T = M.terrain;
  const fills = [M.water, T.plains, T.forest, T.hills, T.mountains, T.desert];
  const inks = [M.waterEdge, T.plains, T.forestInk, T.hillInk, T.mountainInk, T.desertInk];
  const colors = new Uint8Array(8 * 2 * 4);
  [fills, inks].forEach((row, y) => {
    row.forEach((hex, x) => colors.set([...rgb(hex), 255], (y * 8 + x) * 4));
  });
  const colorSource = new BufferImageSource({
    resource: colors,
    width: 8,
    height: 2,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const dataTexture = new Texture({ source: dataSource });
  const colorTexture = new Texture({ source: colorSource });

  const bounds = mapBounds(map.width, map.height, radius);
  const geometry = new MeshGeometry({
    positions: new Float32Array([
      bounds.x,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y + bounds.height,
      bounds.x,
      bounds.y + bounds.height,
    ]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const makeShader = (mode: number): Shader =>
    Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        uData: dataTexture.source,
        uColors: colorTexture.source,
        params: {
          uMap: { value: [map.width, map.height], type: 'vec2<f32>' },
          uR: { value: radius, type: 'f32' },
          uPx: { value: 1, type: 'f32' },
          uPattern: { value: M.patternWidth, type: 'f32' },
          uGrid: { value: 0, type: 'f32' },
          uRiver: { value: 0, type: 'f32' },
          uRiverColor: { value: rgb(M.river).map((c) => c / 255), type: 'vec3<f32>' },
          uGridStyle: { value: [0.5, M.hexGridAlpha], type: 'vec2<f32>' },
          uMode: { value: mode, type: 'f32' },
        },
      },
    });
  const baseShader = makeShader(MODE_BASE);
  const overShader = makeShader(MODE_OVER);
  const base = new Mesh({ geometry, shader: baseShader });
  const over = new Mesh({ geometry, shader: overShader });
  const setUniform = (name: string, value: number): void => {
    for (const shader of [baseShader, overShader]) {
      const group = shader.resources.params as { uniforms: Record<string, unknown> };
      group.uniforms[name] = value;
    }
  };

  return {
    base,
    over,
    setScale(scale, level) {
      setUniform('uPx', 1 / scale);
      setUniform('uGrid', level >= M.hexGridVisibleFromZoom ? 1 : 0);
      setUniform('uRiver', (M.riverWidth[level - 1] ?? M.riverWidth[1] ?? 2.5) / scale);
    },
    destroy() {
      base.destroy();
      over.destroy();
      geometry.destroy();
      dataTexture.destroy(true);
      colorTexture.destroy(true);
    },
  };
}
