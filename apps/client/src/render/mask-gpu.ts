// Режимы карты на GPU: маска по гексам (1 тексель = 1 гекс) красится во фрагментном шейдере.
// Снабжение — градиент красный → жёлтый → зелёный по своей земле; стройка — подсветка гексов, где
// здание можно поставить, остальное затемнено. Цвета — токены статусов и выделения.
import { BufferImageSource, Container, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';

import type { MapStatic } from '@hexfront/sim';

import { mapBounds } from './hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

export type MaskKind = 'supply' | 'build';

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
uniform vec2 uMap;
uniform float uR;
uniform float uPx;
uniform float uKind;
uniform vec3 uBad;
uniform vec3 uMid;
uniform vec3 uGood;
uniform vec3 uAccent;
uniform vec3 uDim;

const float SQRT3 = 1.7320508;
const ivec2 DIRS[6] = ivec2[6](ivec2(1, 0), ivec2(1, -1), ivec2(0, -1), ivec2(-1, 0), ivec2(-1, 1), ivec2(0, 1));

ivec2 toOffset(ivec2 ax) {
  return ivec2(ax.x, ax.y + (ax.x + (ax.x & 1)) / 2);
}

bool inMap(ivec2 o) {
  return o.x >= 0 && o.y >= 0 && o.x < int(uMap.x) && o.y < int(uMap.y);
}

int maskAt(ivec2 ax) {
  ivec2 o = toOffset(ax);
  if (!inMap(o)) return 0;
  return int(texelFetch(uData, o, 0).r * 255.0 + 0.5);
}

float edgeDist(vec2 p, int d, float apothem) {
  float ang = radians(30.0 - 60.0 * float(d));
  return apothem - dot(p, vec2(cos(ang), sin(ang)));
}

vec3 supplyColor(int m) {
  float lvl = float(m - 1) / 100.0;
  return lvl < 0.5 ? mix(uBad, uMid, lvl * 2.0) : mix(uMid, uGood, (lvl - 0.5) * 2.0);
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
  int m = maskAt(ax);
  vec2 p = vWorld - vec2(uR * 1.5 * rq, uR * SQRT3 * (rr + rq * 0.5));
  float apothem = uR * SQRT3 * 0.5;

  if (uKind < 0.5) {
    if (m == 0) {
      finalColor = vec4(uDim * 0.3, 0.3);
      return;
    }
    // Плавный переход цвета между соседними своими гексами (на грани — поровну).
    vec3 c = supplyColor(m);
    float soft = apothem * 0.9;
    for (int d = 0; d < 6; d++) {
      float dist = edgeDist(p, d, apothem);
      if (dist >= soft) continue;
      int nm = maskAt(ax + DIRS[d]);
      if (nm == 0) continue;
      float k = 0.5 * (1.0 - smoothstep(0.0, soft, max(dist, 0.0)));
      c = mix(c, supplyColor(nm), k);
    }
    finalColor = vec4(c * 0.62, 0.62);
    return;
  }

  if (m == 0) {
    finalColor = vec4(uDim * 0.42, 0.42);
    return;
  }
  float ring = 0.0;
  for (int d = 0; d < 6; d++) {
    float dist = edgeDist(p, d, apothem);
    ring = max(ring, clamp((uPx * 2.0 - dist) / uPx + 0.5, 0.0, 1.0));
  }
  if (m == 1) {
    float a = 0.38 + 0.5 * ring;
    finalColor = vec4(uAccent * a, a);
  } else {
    float a = 0.16 + 0.25 * ring;
    finalColor = vec4(uAccent * a, a);
  }
}`;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

export interface MaskGpu {
  readonly container: Container;
  /** Включает режим с маской по гексам или выключает (null). */
  setMask(kind: MaskKind | null, mask: Uint8Array | null): void;
  setScale(scale: number): void;
  destroy(): void;
}

/** Без DOM (юнит-тесты в node) шейдер не компилируется. */
function headlessMask(): MaskGpu {
  return {
    container: new Container(),
    setMask: () => undefined,
    setScale: () => undefined,
    destroy: () => undefined,
  };
}

export function createMaskGpu(map: MapStatic, radius: number): MaskGpu {
  if (typeof document === 'undefined') return headlessMask();
  const data = new Uint8Array(map.width * map.height * 4);
  const source = new BufferImageSource({
    resource: data,
    width: map.width,
    height: map.height,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const texture = new Texture({ source });
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
  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      uData: texture.source,
      params: {
        uMap: { value: [map.width, map.height], type: 'vec2<f32>' },
        uR: { value: radius, type: 'f32' },
        uPx: { value: 1, type: 'f32' },
        uKind: { value: 0, type: 'f32' },
        uBad: { value: rgb(tokens.status.danger), type: 'vec3<f32>' },
        uMid: { value: rgb(tokens.status.lowSupply), type: 'vec3<f32>' },
        uGood: { value: rgb(tokens.status.success), type: 'vec3<f32>' },
        uAccent: { value: rgb(tokens.selection.color), type: 'vec3<f32>' },
        uDim: { value: rgb(tokens.ui.ink), type: 'vec3<f32>' },
      },
    },
  });
  const mesh = new Mesh({ geometry, shader });
  const container = new Container();
  container.visible = false;
  container.addChild(mesh);
  const uniforms = (): Record<string, unknown> =>
    (shader.resources.params as { uniforms: Record<string, unknown> }).uniforms;

  return {
    container,
    setMask(kind, mask) {
      container.visible = kind !== null && mask !== null;
      if (kind === null || mask === null) return;
      uniforms().uKind = kind === 'supply' ? 0 : 1;
      for (let id = 0; id < mask.length; id += 1) {
        data[id * 4] = mask[id] ?? 0;
        data[id * 4 + 3] = 255;
      }
      source.update();
    },
    setScale(scale) {
      uniforms().uPx = 1 / scale;
    },
    destroy() {
      container.destroy({ children: true, context: true });
      geometry.destroy();
      texture.destroy(true);
    },
  };
}
