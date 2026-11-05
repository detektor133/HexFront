// Территория на GPU: владелец и видимость гекса лежат в текстуре карты (1 тексель = 1 гекс),
// заливка, границы и тёмный туман считаются во фрагментном шейдере. На процессоре нет ни
// тесселяции, ни вершинных буферов: смена владельцев — это загрузка нескольких килобайт текстуры.
import { BufferImageSource, Container, Mesh, MeshGeometry, Shader, Texture } from 'pixi.js';

import type { MapStatic, PlayerView } from '@hexfront/sim';

import { mapBounds } from './hex-geometry.ts';
import { playerFill, playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Сколько цветов игроков помещается в палитру-текстуру. */
const PALETTE_SIZE = 32;
const MODE_FILL = 0;
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
uniform sampler2D uPalette;
uniform vec2 uMap;
uniform float uR;
uniform float uPx;
uniform float uBorder;
uniform float uMe;
uniform vec2 uAlpha;
uniform vec4 uFogColor;
uniform vec2 uFog;
uniform float uMode;

const float SQRT3 = 1.7320508;
const ivec2 DIRS[6] = ivec2[6](ivec2(1, 0), ivec2(1, -1), ivec2(0, -1), ivec2(-1, 0), ivec2(-1, 1), ivec2(0, 1));

ivec2 toOffset(ivec2 ax) {
  return ivec2(ax.x, ax.y + (ax.x + (ax.x & 1)) / 2);
}

bool inMap(ivec2 o) {
  return o.x >= 0 && o.y >= 0 && o.x < int(uMap.x) && o.y < int(uMap.y);
}

int ownerAt(ivec2 ax) {
  ivec2 o = toOffset(ax);
  if (!inMap(o)) return 0;
  return int(texelFetch(uData, o, 0).r * 255.0 + 0.5);
}

vec4 palette(int owner, float row) {
  return texelFetch(uPalette, ivec2(owner, int(row)), 0);
}

// Расстояние внутрь гекса от грани d: 0 на грани, апофема в центре.
float edgeDist(vec2 p, int d, float apothem) {
  float ang = radians(30.0 - 60.0 * float(d));
  return apothem - dot(p, vec2(cos(ang), sin(ang)));
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
  ivec2 off = toOffset(ax);
  if (!inMap(off)) discard;
  vec4 cell = texelFetch(uData, off, 0);
  int owner = int(cell.r * 255.0 + 0.5);
  vec2 p = vWorld - vec2(uR * 1.5 * rq, uR * SQRT3 * (rr + rq * 0.5));
  float apothem = uR * SQRT3 * 0.5;

  if (uMode < 0.5) {
    if (owner == 0) discard;
    // Плавный край: к ничьей земле заливка тает, к чужому владельцу цвет перетекает (на грани — поровну).
    float soft = apothem * 0.35;
    float cover = 1.0;
    float hexDist = 0.0;
    float a = float(owner) == uMe ? uAlpha.x : uAlpha.y;
    vec3 c = palette(owner, 0.0).rgb;
    vec3 line = palette(owner, 1.0).rgb;
    vec3 mixC = c;
    float mixA = a;
    for (int d = 0; d < 6; d++) {
      float dist = edgeDist(p, d, apothem);
      hexDist = max(hexDist, 1.0 - dist / apothem);
      if (dist >= soft) continue;
      int no = ownerAt(ax + DIRS[d]);
      if (no == owner) continue;
      float t = smoothstep(0.0, soft, max(dist, 0.0));
      if (no == 0) {
        cover = min(cover, 0.3 + 0.7 * t);
      } else {
        float k = 0.5 * (1.0 - t);
        mixC = mix(mixC, palette(no, 0.0).rgb, k);
        mixA = mix(mixA, float(no) == uMe ? uAlpha.x : uAlpha.y, k);
      }
    }
    c = mixC;
    a = mixA;
    // Захват: цвет нового владельца заливает гекс от центра к краям, затухая (B — остаток эффекта).
    float fade = cell.b;
    if (fade > 0.0 && hexDist <= 1.0 - fade) {
      c = mix(c, line, fade);
      a = mix(a, 1.0, fade);
    }
    a *= cover;
    finalColor = vec4(c * a, a);
    return;
  }

  vec4 outColor = vec4(0.0);
  if (owner != 0) {
    float bw = uBorder;
    float feather = uPx * 1.5;
    float cover = 0.0;
    for (int d = 0; d < 6; d++) {
      float dist = edgeDist(p, d, apothem);
      if (dist > bw + feather) continue;
      if (ownerAt(ax + DIRS[d]) == owner) continue;
      float cv = (1.0 - smoothstep(bw * 0.5, bw + feather, dist)) * clamp(dist / uPx + 0.5, 0.0, 1.0);
      cover = max(cover, cv);
    }
    if (cover > 0.0) outColor = vec4(palette(owner, 1.0).rgb * cover, cover);
  }
  // Туман: тёмная пелена на невидимом; на границе видимого и скрытого затемнение плавно меняется.
  float hid = cell.g < 0.5 ? 1.0 : 0.0;
  float fogV = hid;
  float fsoft = apothem * uFog.x;
  for (int d = 0; d < 6; d++) {
    float dist = edgeDist(p, d, apothem);
    if (dist >= fsoft) continue;
    ivec2 o = toOffset(ax + DIRS[d]);
    if (!inMap(o)) continue;
    float nh = texelFetch(uData, o, 0).g < 0.5 ? 1.0 : 0.0;
    if (nh == hid) continue;
    float k = 0.5 * (1.0 - smoothstep(0.0, fsoft, max(dist, 0.0)));
    fogV = mix(fogV, nh, k);
  }
  float fa = uFogColor.a * fogV;
  if (fa > 0.0) outColor = vec4(uFogColor.rgb * fa + outColor.rgb * (1.0 - fa), fa + outColor.a * (1.0 - fa));
  if (outColor.a <= 0.0) discard;
  finalColor = outColor;
}`;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export interface TerritoryGpu {
  /** Заливка территории — под дорогами и фишками. */
  readonly fill: Container;
  /** Границы и тёмный туман — над заливкой. */
  readonly over: Container;
  setView(view: PlayerView): void;
  /** Остаток вспышки захвата гекса, 0..1 (0 — нет эффекта); загрузка в текстуру — `flush`. */
  setCapture(hex: number, fade: number): void;
  /** Загружает в GPU накопленные изменения вспышек захвата. */
  flush(): void;
  /** Толщины линий — экранные px, шейдеру нужен масштаб камеры. */
  setScale(scale: number): void;
  destroy(): void;
}

/**
 * Пишет владельца и видимость гексов в RGBA-текстуру карты: R = владелец + 1 (0 — ничей),
 * G = 255 для видимого гекса.
 * @returns true, если данные изменились и текстуру нужно загрузить заново
 */
export function packTerritory(view: PlayerView, data: Uint8Array): boolean {
  const { owner, visible } = view.hexes;
  let changed = false;
  for (let id = 0; id < owner.length; id += 1) {
    const o = (owner[id] ?? -1) + 1;
    const v = visible[id] === 0 ? 0 : 255;
    const at = id * 4;
    if (data[at] !== o || data[at + 1] !== v || data[at + 3] !== 255) {
      data[at] = o;
      data[at + 1] = v;
      data[at + 3] = 255;
      changed = true;
    }
  }
  return changed;
}

/** Без DOM (юнит-тесты в node) шейдер не компилируется: вместо слоя — пустые контейнеры. */
function headlessTerritory(): TerritoryGpu {
  return {
    fill: new Container(),
    over: new Container(),
    setView: () => undefined,
    setCapture: () => undefined,
    flush: () => undefined,
    setScale: () => undefined,
    destroy: () => undefined,
  };
}

export function createTerritoryGpu(map: MapStatic, radius: number): TerritoryGpu {
  if (typeof document === 'undefined') return headlessTerritory();
  const data = new Uint8Array(map.width * map.height * 4);
  const dataSource = new BufferImageSource({
    resource: data,
    width: map.width,
    height: map.height,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const paletteData = new Uint8Array(PALETTE_SIZE * 2 * 4);
  const paletteSource = new BufferImageSource({
    resource: paletteData,
    width: PALETTE_SIZE,
    height: 2,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const dataTexture = new Texture({ source: dataSource });
  const paletteTexture = new Texture({ source: paletteSource });

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

  const fog = rgb(tokens.fog.dark);
  const makeShader = (mode: number): Shader =>
    Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        uData: dataTexture.source,
        uPalette: paletteTexture.source,
        params: {
          uMap: { value: [map.width, map.height], type: 'vec2<f32>' },
          uR: { value: radius, type: 'f32' },
          uPx: { value: 1, type: 'f32' },
          uBorder: { value: tokens.territory.borderWidth[0], type: 'f32' },
          uMe: { value: 0, type: 'f32' },
          uAlpha: {
            value: [tokens.territory.alphaOwn, tokens.territory.alphaOther],
            type: 'vec2<f32>',
          },
          uFogColor: {
            value: [fog[0] / 255, fog[1] / 255, fog[2] / 255, tokens.fog.darkAlpha],
            type: 'vec4<f32>',
          },
          uFog: {
            value: [tokens.fog.soft, 0],
            type: 'vec2<f32>',
          },
          uMode: { value: mode, type: 'f32' },
        },
      },
    });
  const fillShader = makeShader(MODE_FILL);
  const overShader = makeShader(MODE_OVER);
  const fill = new Mesh({ geometry, shader: fillShader });
  const over = new Mesh({ geometry, shader: overShader });

  const setUniform = (name: string, value: number): void => {
    for (const shader of [fillShader, overShader]) {
      const group = shader.resources.params as { uniforms: Record<string, unknown> };
      group.uniforms[name] = value;
    }
  };

  const writePalette = (): void => {
    const next = new Uint8Array(paletteData.length);
    for (let i = 1; i < PALETTE_SIZE; i += 1) {
      next.set([...rgb(playerFill(i - 1)), 255], i * 4);
      next.set([...rgb(playerLine(i - 1)), 255], (PALETTE_SIZE + i) * 4);
    }
    if (next.every((value, index) => value === paletteData[index])) return;
    paletteData.set(next);
    paletteSource.update();
  };

  let captureDirty = false;
  return {
    fill,
    over,
    setCapture(hex, fade) {
      const value = fade <= 0 ? 0 : Math.max(1, Math.round(Math.min(1, fade) * 255));
      if (data[hex * 4 + 2] === value) return;
      data[hex * 4 + 2] = value;
      captureDirty = true;
    },
    flush() {
      if (!captureDirty) return;
      captureDirty = false;
      dataSource.update();
    },
    setView(view) {
      if (packTerritory(view, data)) dataSource.update();
      // Порядок цветов задаёт клиент (setPlayerPalette) — сверяем палитру на каждом виде.
      writePalette();
      setUniform('uMe', view.playerId + 1);
    },
    setScale(scale) {
      setUniform('uPx', 1 / scale);
      setUniform('uBorder', tokens.territory.borderWidth[0] / scale);
    },
    destroy() {
      fill.destroy();
      over.destroy();
      geometry.destroy();
      dataTexture.destroy(true);
      paletteTexture.destroy(true);
    },
  };
}
