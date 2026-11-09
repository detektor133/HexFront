// Фишки отрядов на GPU (art/units.md, «Фишка отряда»): все фишки — один вызов отрисовки. Каждая
// фишка — экземпляр квадрата, а корпус, закладка, звёзды, глиф, столбики, стрелка атаки, значки и
// рамки вычисляет фрагментный шейдер по тем же числам, что и рисование на процессоре
// (chip-layout.ts). Числа подписи берутся из атласа символов, нарисованного шрифтом интерфейса.
// На процессоре на фишку остаётся запись нескольких чисел в буфер: ни дерева объектов, ни
// пересборки Graphics и текста, поэтому большая война не тормозит кадр.
import {
  Buffer,
  BufferUsage,
  CanvasSource,
  Container,
  Geometry,
  Mesh,
  Rectangle,
  Shader,
  Texture,
} from 'pixi.js';

import { DIRECTIONS } from '@hexfront/sim';

import {
  ATTACK_ARROW,
  ATTACK_SLOT,
  BAR_GAP,
  BAR_INSET,
  BAR_W,
  COUNT_PX,
  COUNT_R,
  GHOST_DASH,
  GLYPH,
  H,
  LABEL_PX,
  LOW_SUPPLY,
  OUTLINE,
  PAD,
  RETREAT_ALPHA,
  SQUARE,
  STAR_R,
  STAR_STEP,
  TAB_STARS,
  WARN,
  chipLayout,
} from './chip-layout.ts';
import { supplyColor, type ChipState } from './unit-chips.ts';
import { formatSoldiers } from '../i18n/format.ts';
import { hexCenter } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

/** Поле запаса вокруг корпуса в px фишки: рамка выбора, круг числа отрядов. */
const MARGIN = 12;

/** Сколько чисел хранится на одну фишку в буфере свойств. */
const STRIDE = 40;
const TYPES: Readonly<Record<string, number>> = { infantry: 0, armor: 1, artillery: 2 };

/** Символы атласа подписи: цифры, разделители и суффиксы тысяч обоих языков. */
const GLYPHS = '0123456789.,кkK';
/** Размер шрифта атласа, px: подпись фишки (12 px) — уменьшение в 3–4 раза, с mip-уровнями. */
const ATLAS_FONT = 44;
const ATLAS_MARGIN = 6;
const ATLAS_CELL_H = 64;
const LABEL_CODES = 6;
const COUNT_CODES = 4;

/** Раскладка одной фишки в буфере. */
export interface GpuChip {
  readonly key: string;
  readonly state: ChipState;
}

/** Фишки на GPU. */
export interface ChipGpu {
  readonly container: Container;
  /**
   * Задаёт состав фишек по порядку отрисовки.
   * @returns ширина каждой фишки для попадания по ключу (0 у призрака набора)
   */
  sync(chips: readonly GpuChip[], compact: boolean): ReadonlyMap<string, number>;
  /** Ставит фишку номер index в мировую точку. */
  place(index: number, x: number, y: number): void;
  /** Отправляет положения на видеокарту: раз в кадр после всех place. */
  flush(): void;
  /** Масштаб фишки в мире и масштаб камеры: ширина сглаживания краёв — один экранный пиксель. */
  setScale(chipWorld: number, cameraScale: number): void;
  destroy(): void;
}

function toChannels(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Номера символов подписи в атласе; неизвестные символы пропускаются. */
export function glyphCodes(text: string, max: number): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const i = GLYPHS.indexOf(ch);
    if (i >= 0 && out.length < max) out.push(i);
  }
  while (out.length < max) out.push(-1);
  return out;
}

/**
 * Записывает фишку в буфер свойств: геометрия, вид, флаги, столбики, цвета и символы подписи.
 * Положение хранится отдельно — оно меняется каждый кадр.
 */
export function packChip(
  out: Float32Array,
  at: number,
  s: ChipState,
  compact: boolean,
): { readonly width: number } {
  const label = formatSoldiers(s.soldiers);
  const layout = chipLayout(s, label.length, compact);
  const mode = s.ghost ? 2 : compact ? 1 : 0;
  const warn =
    s.starving || (s.supply !== null && s.supply < LOW_SUPPLY) ? (s.starving ? 2 : 1) : 0;
  const color = toChannels(s.color);
  const army = toChannels(s.army ?? s.color);
  const sup = s.supply === null ? color : toChannels(supplyColor(s.supply, s.starving));
  const lab = glyphCodes(label, LABEL_CODES);
  const n = s.count ?? 1;
  const cnt = glyphCodes(n > 1 ? String(n) : '', COUNT_CODES);
  const v = [
    layout.w,
    mode,
    layout.tab,
    layout.labelCx,
    TYPES[s.type] ?? 0,
    s.stars ?? 0,
    s.attackDirection ?? -1,
    n,
    s.selected ? 1 : 0,
    s.encircled ? 1 : 0,
    s.retreating ? 1 : 0,
    warn,
    s.org,
    s.supply ?? -1,
    0,
    0,
    color[0],
    color[1],
    color[2],
    0,
    army[0],
    army[1],
    army[2],
    s.army ? 1 : 0,
    sup[0],
    sup[1],
    sup[2],
    0,
    lab[0] ?? -1,
    lab[1] ?? -1,
    lab[2] ?? -1,
    lab[3] ?? -1,
    lab[4] ?? -1,
    lab[5] ?? -1,
    0,
    0,
    cnt[0] ?? -1,
    cnt[1] ?? -1,
    cnt[2] ?? -1,
    cnt[3] ?? -1,
  ];
  out.set(v, at);
  return { width: layout.width };
}

/** Атлас символов подписи: белые символы в ряд, у каждого запас по краям. */
interface Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly cellW: number;
  /** Ширина символов в px атласа, по номеру символа. */
  readonly advance: number[];
  /** Сдвиг базовой линии, чтобы середина цифр стояла на середине ячейки. */
  readonly draw: () => void;
}

function buildAtlas(): Atlas | null {
  const family = tokens.font.ui.family;
  const canvas = document.createElement?.('canvas');
  const probe = canvas?.getContext?.('2d');
  // Без 2d-канвы (тестовое окружение без браузера) фишки рисует процессор.
  if (!canvas || !probe || typeof probe.clearRect !== 'function') return null;
  const font = `500 ${ATLAS_FONT}px "${family}", sans-serif`;
  const advance: number[] = [];
  const measure = (): void => {
    probe.font = font;
    advance.length = 0;
    for (const ch of GLYPHS) advance.push(probe.measureText(ch).width);
  };
  measure();
  const cellW = Math.ceil(Math.max(...advance) + ATLAS_MARGIN * 2) + 2;
  canvas.width = cellW * GLYPHS.length;
  canvas.height = ATLAS_CELL_H;
  const draw = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.fillStyle = tokens.ui.surface;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    measure();
    const zero = ctx.measureText('0');
    const centre = (zero.actualBoundingBoxAscent - zero.actualBoundingBoxDescent) / 2;
    let i = 0;
    for (const ch of GLYPHS) {
      ctx.fillText(ch, i * cellW + ATLAS_MARGIN, ATLAS_CELL_H / 2 + centre);
      i += 1;
    }
  };
  draw();
  return { canvas, cellW, advance, draw };
}

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));

const DIR_SRC = DIRECTIONS.map((d) => {
  const v = hexCenter(d, 1);
  const len = Math.hypot(v.x, v.y);
  return `vec2(${f(v.x / len)}, ${f(v.y / len)})`;
}).join(', ');

const STAR_SRC = Array.from({ length: 10 }, (_, k) => {
  const r = k % 2 === 0 ? STAR_R : STAR_R * 0.45;
  const a = -Math.PI / 2 + (k * Math.PI) / 5;
  return `vec2(${f(Number((Math.cos(a) * r).toFixed(5)))}, ${f(Number((Math.sin(a) * r).toFixed(5)))})`;
}).join(', ');

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 iPos;
in vec4 iGeom;
in vec4 iKind;
in vec4 iFlags;
in vec4 iBars;
in vec4 iColor;
in vec4 iArmor;
in vec4 iSup;
in vec4 iLab0;
in vec4 iLab1;
in vec4 iCnt;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uScale;
out vec2 vLocal;
flat out vec4 fGeom;
flat out vec4 fKind;
flat out vec4 fFlags;
flat out vec4 fBars;
flat out vec4 fColor;
flat out vec4 fArmor;
flat out vec4 fSup;
flat out vec4 fLab0;
flat out vec4 fLab1;
flat out vec4 fCnt;
void main() {
  vec2 half_ = vec2(iGeom.x * 0.5 + ${f(MARGIN)}, ${f(H / 2 + MARGIN)});
  vec2 local = aPosition * half_;
  vec2 world = iPos + local * uScale;
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(world, 1.0)).xy, 0.0, 1.0);
  vLocal = local;
  fGeom = iGeom; fKind = iKind; fFlags = iFlags; fBars = iBars; fColor = iColor;
  fArmor = iArmor; fSup = iSup; fLab0 = iLab0; fLab1 = iLab1; fCnt = iCnt;
}`;

const FRAGMENT = (cells: number, cellW: number): string => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vLocal;
flat in vec4 fGeom;
flat in vec4 fKind;
flat in vec4 fFlags;
flat in vec4 fBars;
flat in vec4 fColor;
flat in vec4 fArmor;
flat in vec4 fSup;
flat in vec4 fLab0;
flat in vec4 fLab1;
flat in vec4 fCnt;
out vec4 finalColor;
uniform sampler2D uAtlas;
uniform float uPx;
uniform vec4 uAdv0;
uniform vec4 uAdv1;
uniform vec4 uAdv2;
uniform vec4 uAdv3;
uniform vec3 uInk;
uniform vec3 uInk2;
uniform vec3 uSurface;
uniform vec3 uTrack;
uniform vec3 uOrg;
uniform vec3 uSel;
uniform vec3 uDanger;
uniform vec3 uLow;
uniform vec3 uEnc;
uniform vec4 uSelect;

const float H = ${f(H)};
const float RADIUS = ${f(tokens.radius.chip)};
const float SQUARE = ${f(SQUARE)};
const float PAD = ${f(PAD)};
const float OUTLINE = ${f(OUTLINE)};
const float BAR_W = ${f(BAR_W)};
const float BAR_GAP = ${f(BAR_GAP)};
const float BAR_INSET = ${f(BAR_INSET)};
const float TAB_STARS = ${f(TAB_STARS)};
const float STAR_STEP = ${f(STAR_STEP)};
const float WARN = ${f(WARN)};
const float COUNT_R = ${f(COUNT_R)};
const float ATTACK_SLOT = ${f(ATTACK_SLOT)};
const float ATTACK_ARROW = ${f(ATTACK_ARROW)};
const float GLYPH = ${f(GLYPH)};
const float GHOST_DASH = ${f(GHOST_DASH)};
const float LABEL_PX = ${f(LABEL_PX)};
const float COUNT_PX = ${f(COUNT_PX)};
const float FONT = ${f(ATLAS_FONT)};
const float CELL_W = ${f(cellW)};
const float CELL_H = ${f(ATLAS_CELL_H)};
const float CELLS = ${f(cells)};
const float MARGIN_A = ${f(ATLAS_MARGIN)};
const vec2 DIRS[6] = vec2[6](${DIR_SRC});
const vec2 STAR[10] = vec2[10](${STAR_SRC});

vec4 acc = vec4(0.0);

float cov(float d) { return clamp(0.5 - d / uPx, 0.0, 1.0); }

// Кладёт цвет с покрытием поверх накопленного (предумноженная альфа).
void put(vec3 c, float coverage, float alpha) {
  float a = coverage * alpha;
  acc = vec4(c * a + acc.rgb * (1.0 - a), a + acc.a * (1.0 - a));
}

float sdBox(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sdRBox(vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdStar(vec2 q) {
  float d = dot(q - STAR[0], q - STAR[0]);
  float s = 1.0;
  for (int i = 0, j = 9; i < 10; j = i, i++) {
    vec2 e = STAR[j] - STAR[i];
    vec2 w = q - STAR[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(q.y >= STAR[i].y, q.y < STAR[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
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

float adv(int i) {
  vec4 q = i < 4 ? uAdv0 : (i < 8 ? uAdv1 : (i < 12 ? uAdv2 : uAdv3));
  int k = i - (i / 4) * 4;
  return k == 0 ? q.x : (k == 1 ? q.y : (k == 2 ? q.z : q.w));
}

// Подпись из ячеек атласа: символы идут подряд, вся строка стоит по центру c.
float textCov(vec2 p, vec2 c, float fontPx, vec4 a, vec4 b) {
  float s = fontPx / FONT;
  float total = 0.0;
  for (int i = 0; i < 6; i++) {
    float k = i < 4 ? a[i] : b[i - 4];
    if (k < 0.0) break;
    total += adv(int(k));
  }
  float pen = c.x - total * s * 0.5;
  float result = 0.0;
  vec2 gx = vec2(uPx / (CELL_W * s * CELLS), 0.0);
  vec2 gy = vec2(0.0, uPx / (CELL_H * s));
  for (int i = 0; i < 6; i++) {
    float k = i < 4 ? a[i] : b[i - 4];
    if (k < 0.0) break;
    float x0 = pen - MARGIN_A * s;
    vec2 uv = vec2((p.x - x0) / (CELL_W * s), (p.y - c.y) / (CELL_H * s) + 0.5);
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      result = max(result, textureGrad(uAtlas, vec2((k + uv.x) / CELLS, uv.y), gx, gy).a);
    }
    pen += adv(int(k)) * s;
  }
  return result;
}

void vbar(vec2 p, float x, float share, vec3 color) {
  float barTop = -H * 0.5 + 4.0;
  float barH = H - 8.0;
  put(uTrack, cov(sdRBox(p, vec2(x + 2.0, barTop + barH * 0.5), vec2(2.0, barH * 0.5), 2.0)), 1.0);
  float fill = barH * clamp(share, 0.0, 1.0);
  if (fill > 0.0) {
    float hh = max(fill, BAR_W);
    float top = barTop + barH - fill;
    put(color, cov(sdRBox(p, vec2(x + 2.0, top + hh * 0.5), vec2(2.0, hh * 0.5), 2.0)), 1.0);
  }
}

void glyph(vec2 p, float sq, int type, vec3 color) {
  vec2 q = p - vec2(sq + (SQUARE - GLYPH) * 0.5, -H * 0.5 + (H - GLYPH) * 0.5);
  float d;
  if (type == 0) {
    d = min(sdSeg(q, vec2(2.0, 10.0), vec2(7.0, 5.0)), sdSeg(q, vec2(7.0, 5.0), vec2(12.0, 10.0))) - 1.0;
  } else if (type == 1) {
    vec2 a = vec2(7.0, 2.0); vec2 b = vec2(12.0, 7.0); vec2 c = vec2(7.0, 12.0); vec2 e = vec2(2.0, 7.0);
    d = min(min(sdSeg(q, a, b), sdSeg(q, b, c)), min(sdSeg(q, c, e), sdSeg(q, e, a))) - 1.0;
  } else {
    vec2 m = q - vec2(7.0, 10.0);
    float arch = m.y <= 0.0 ? abs(length(m) - 5.0) : min(length(m - vec2(5.0, 0.0)), length(m + vec2(5.0, 0.0)));
    d = min(arch - 1.0, length(m) - 1.75);
  }
  put(color, cov(d), 1.0);
}

void main() {
  vec2 p = vLocal;
  float w = fGeom.x;
  float mode = fGeom.y;
  float tab = fGeom.z;
  vec3 color = fColor.rgb;
  float left = -w * 0.5;
  float top = -H * 0.5;
  float org = fBars.x;
  float supply = fBars.y;
  float sel = fFlags.x;
  float enc = fFlags.y;
  float retreat = fFlags.z;
  int count = int(fKind.w + 0.5);
  vec3 labelColor = uInk;

  if (mode > 1.5) {
    // Призрак набора: пунктирный контур, глиф и столбик прогресса.
    labelColor = color;
    float inX = cov(abs(p.x - 0.0) - w * 0.5);
    float phase = mod(p.x - left, GHOST_DASH * 2.0);
    float dash = 1.0 - step(GHOST_DASH, phase);
    float bandTop = cov(abs(p.y - top) - OUTLINE * 0.5);
    float bandBot = cov(abs(p.y - (top + H)) - OUTLINE * 0.5);
    put(color, max(bandTop, bandBot) * inX * dash, 1.0);
    float sideL = cov(abs(p.x - left) - OUTLINE * 0.5) * cov(abs(p.y) - H * 0.5);
    float sideR = cov(abs(p.x - (left + w)) - OUTLINE * 0.5) * cov(abs(p.y) - H * 0.5);
    put(color, max(sideL, sideR), 1.0);
    glyph(p, left, int(fKind.x + 0.5), color);
    vbar(p, left + w - BAR_INSET - BAR_W, org, color);
  } else if (mode > 0.5) {
    // Свёрнутая фишка: цветной щит с числом.
    labelColor = uSurface;
    float dBody = sdRBox(p, vec2(0.0), vec2(w * 0.5, H * 0.5), RADIUS);
    put(color, cov(dBody), 1.0);
    if (fArmor.w > 0.5) {
      float tw = fGeom.z + RADIUS;
      put(fArmor.rgb, cov(sdRBox(p, vec2(left + tw * 0.5, 0.0), vec2(tw * 0.5, H * 0.5), RADIUS)), 1.0);
    }
    if (sel > 0.5) put(uInk, cov(abs(sdRBox(p, vec2(0.0), vec2(w * 0.5 + 3.0, H * 0.5 + 3.0), RADIUS + 3.0)) - 1.0), 1.0);
    vec3 bc = sel > 0.5 ? uSel : uSurface;
    float bw = sel > 0.5 ? uSelect.x + 1.5 : OUTLINE;
    put(bc, cov(abs(dBody) - bw * 0.5), 1.0);
  } else {
    float sq = left + tab;
    float dBody = sdRBox(p, vec2(0.0), vec2(w * 0.5, H * 0.5), RADIUS);
    put(uSurface, cov(dBody), 1.0);
    vec3 tabColor = fArmor.w > 0.5 ? fArmor.rgb : color;
    if (tab > 0.0) {
      float tw = tab + RADIUS;
      put(tabColor, cov(sdRBox(p, vec2(left + tw * 0.5, 0.0), vec2(tw * 0.5, H * 0.5), RADIUS)), 1.0);
      put(color, cov(sdBox(p, vec2(sq + SQUARE * 0.5, 0.0), vec2(SQUARE * 0.5, H * 0.5))), 1.0);
    } else {
      put(color, cov(sdRBox(p, vec2(sq + SQUARE * 0.5, 0.0), vec2(SQUARE * 0.5, H * 0.5), RADIUS)), 1.0);
      float rw = (SQUARE - RADIUS) * 0.5;
      put(color, cov(sdBox(p, vec2(sq + RADIUS + rw, 0.0), vec2(rw, H * 0.5))), 1.0);
    }
    if (sel > 0.5) put(uInk, cov(abs(sdRBox(p, vec2(0.0), vec2(w * 0.5 + 3.0, H * 0.5 + 3.0), RADIUS + 3.0)) - 1.0), 1.0);
    vec3 bc = sel > 0.5 ? uSel : (enc > 0.5 ? uEnc : color);
    float bw = sel > 0.5 ? uSelect.x + 1.5 : (enc > 0.5 ? 2.0 : OUTLINE);
    put(bc, cov(abs(dBody) - bw * 0.5), 1.0);
    // Звёзды опыта столбиком на закладке.
    int stars = int(fKind.y + 0.5);
    for (int i = 0; i < 3; i++) {
      if (i >= stars) break;
      vec2 c = vec2(left + TAB_STARS * 0.5, (float(i) - (float(stars) - 1.0) * 0.5) * STAR_STEP);
      put(uSurface, cov(sdStar(p - c)), 1.0);
    }
    glyph(p, sq, int(fKind.x + 0.5), uSurface);
    // Столбики: снабжение (у своих) правее организации.
    float bx = left + w - BAR_INSET - BAR_W;
    if (supply >= 0.0) {
      vbar(p, bx, supply, fSup.rgb);
      bx -= BAR_W + BAR_GAP;
    }
    vbar(p, bx, org, uOrg);
    // Стрелка атаки к соседнему гексу цели.
    int dirIndex = int(fKind.z + 0.5);
    if (fKind.z > -0.5) {
      vec2 d = DIRS[dirIndex];
      vec2 perp = vec2(-d.y, d.x);
      vec2 c = vec2(sq + SQUARE + PAD + ATTACK_SLOT * 0.5, 0.0);
      vec2 tip = c + d * (ATTACK_ARROW * 0.5);
      vec2 tail = c - d * (ATTACK_ARROW * 0.5);
      vec2 wing = tip - d * 3.0;
      float da = min(sdSeg(p, tail, tip), min(sdSeg(p, tip, wing + perp * 3.0), sdSeg(p, tip, wing - perp * 3.0)));
      put(uInk2, cov(da - 1.0), 1.0);
    }
    // Нехватка снабжения: треугольник в углу квадрата.
    if (fFlags.w > 0.5) {
      vec2 c = vec2(sq + SQUARE - WARN * 0.5 - 2.0, top + WARN * 0.5 + 2.0);
      float dt = sdTri(p, c + vec2(0.0, -WARN * 0.5), c + vec2(WARN * 0.5, WARN * 0.5), c + vec2(-WARN * 0.5, WARN * 0.5));
      put(fFlags.w > 1.5 ? uDanger : uLow, cov(dt), 1.0);
      put(uSurface, cov(abs(dt) - 0.5), 1.0);
    }
  }

  // Число отрядов стопки: тёмный круг с белой каймой на правом верхнем углу.
  vec2 cc = vec2(left + w - 2.0, top + 2.0);
  if (count > 1) {
    float dc = length(p - cc) - COUNT_R;
    put(uInk, cov(dc), 1.0);
    put(uSurface, cov(abs(dc) - 0.75), 1.0);
  }
  if (mode < 0.5 && retreat > 0.5) {
    // Штриховка отступления остаётся внутри корпуса.
    float t = p.x + p.y - (left + top);
    float m = mod(t, 7.0);
    float line = min(m, 7.0 - m) * 0.70710678;
    float inBox = cov(sdBox(p, vec2(0.0), vec2(w * 0.5, H * 0.5)));
    put(uSurface, cov(line - 0.75) * inBox, 0.3);
  }
  // Подписи поверх всего.
  float label = textCov(p, vec2(fGeom.w, 0.0), LABEL_PX, fLab0, fLab1);
  put(labelColor, label, 1.0);
  if (count > 1) put(uSurface, textCov(p, cc, COUNT_PX, fCnt, vec4(-1.0)), 1.0);

  finalColor = acc * (retreat > 0.5 && mode < 1.5 ? ${f(RETREAT_ALPHA)} : 1.0);
}`;

function channels(color: string): number[] {
  return toChannels(color);
}

const ATTRS: ReadonlyArray<readonly [string, number]> = [
  ['iGeom', 0],
  ['iKind', 4],
  ['iFlags', 8],
  ['iBars', 12],
  ['iColor', 16],
  ['iArmor', 20],
  ['iSup', 24],
  ['iLab0', 28],
  ['iLab1', 32],
  ['iCnt', 36],
];

/** Создаёт слой фишек на GPU; без документа (тесты в Node) возвращает null. */
export function createChipGpu(): ChipGpu | null {
  if (typeof document === 'undefined') return null;
  // ?chips=legacy возвращает рисование фишек на процессоре — для сравнения и на случай отказа.
  if (new URLSearchParams(globalThis.location?.search ?? '').get('chips') === 'legacy') return null;
  const atlas = buildAtlas();
  if (atlas === null) return null;
  const source = new CanvasSource({
    resource: atlas.canvas,
    autoGenerateMipmaps: true,
    scaleMode: 'linear',
    mipmapFilter: 'linear',
    addressMode: 'clamp-to-edge',
  });
  const texture = new Texture({ source });
  const corners = new Buffer({
    data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const index = new Buffer({
    data: new Uint32Array([0, 1, 2, 0, 2, 3]),
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
  });
  let capacity = 256;
  let statics = new Float32Array(capacity * STRIDE);
  let positions = new Float32Array(capacity * 2);
  const staticBuffer = new Buffer({
    data: statics,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const positionBuffer = new Buffer({
    data: positions,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const attributes: Record<
    string,
    {
      buffer: Buffer;
      format: 'float32x2' | 'float32x4';
      stride: number;
      offset: number;
      instance?: boolean;
    }
  > = {
    aPosition: { buffer: corners, format: 'float32x2', stride: 8, offset: 0 },
    iPos: {
      buffer: positionBuffer,
      format: 'float32x2',
      stride: 8,
      offset: 0,
      instance: true,
    },
  };
  for (const [name, at] of ATTRS) {
    attributes[name] = {
      buffer: staticBuffer,
      format: 'float32x4',
      stride: STRIDE * 4,
      offset: at * 4,
      instance: true,
    };
  }
  const geometry = new Geometry({
    attributes,
    indexBuffer: index,
    topology: 'triangle-list',
    instanceCount: 0,
  });
  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT(GLYPHS.length, atlas.cellW) },
    resources: {
      uAtlas: texture.source,
      params: {
        uScale: { value: 0.55, type: 'f32' },
        uPx: { value: 1, type: 'f32' },
        uAdv0: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uAdv1: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uAdv2: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uAdv3: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uInk: { value: channels(tokens.ui.ink), type: 'vec3<f32>' },
        uInk2: { value: channels(tokens.ui.ink2), type: 'vec3<f32>' },
        uSurface: { value: channels(tokens.ui.surface), type: 'vec3<f32>' },
        uTrack: { value: channels(tokens.chip.track), type: 'vec3<f32>' },
        uOrg: { value: channels(tokens.chip.org), type: 'vec3<f32>' },
        uSel: { value: channels(tokens.selection.color), type: 'vec3<f32>' },
        uDanger: { value: channels(tokens.status.danger), type: 'vec3<f32>' },
        uLow: { value: channels(tokens.status.lowSupply), type: 'vec3<f32>' },
        uEnc: { value: channels(tokens.status.encircled), type: 'vec3<f32>' },
        uSelect: { value: [tokens.selection.width, 0, 0, 0], type: 'vec4<f32>' },
      },
    },
  });
  const uniforms = (): Record<string, unknown> =>
    (shader.resources.params as { uniforms: Record<string, unknown> }).uniforms;
  const writeAdvances = (): void => {
    const u = uniforms();
    const a = [...atlas.advance, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    u.uAdv0 = a.slice(0, 4);
    u.uAdv1 = a.slice(4, 8);
    u.uAdv2 = a.slice(8, 12);
    u.uAdv3 = a.slice(12, 16);
  };
  writeAdvances();
  // Шрифт интерфейса может догрузиться после создания слоя: тогда атлас рисуется заново.
  const family = tokens.font.ui.family;
  void document.fonts
    ?.load(`500 ${ATLAS_FONT}px "${family}"`, GLYPHS)
    .then(() => {
      atlas.draw();
      writeAdvances();
      source.update();
    })
    .catch(() => undefined);

  const mesh = new Mesh({ geometry, shader });
  mesh.boundsArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
  const container = new Container();
  container.addChild(mesh);
  let count = 0;
  let chipWorld = 0.55;
  let camera = 1;
  const px = (): number => 1 / (chipWorld * camera * (globalThis.window?.devicePixelRatio ?? 1));

  const grow = (n: number): void => {
    if (n <= capacity) return;
    while (capacity < n) capacity *= 2;
    statics = new Float32Array(capacity * STRIDE);
    positions = positions.length >= capacity * 2 ? positions : grownPositions(positions, capacity);
    staticBuffer.data = statics;
    positionBuffer.data = positions;
  };
  const grownPositions = (old: Float32Array, cap: number): Float32Array<ArrayBuffer> => {
    const next = new Float32Array(cap * 2);
    next.set(old);
    return next;
  };

  return {
    container,
    sync(chips, compact) {
      grow(chips.length);
      const widths = new Map<string, number>();
      chips.forEach((chip, i) => {
        const { width } = packChip(statics, i * STRIDE, chip.state, compact);
        widths.set(chip.key, width);
      });
      count = chips.length;
      geometry.instanceCount = count;
      staticBuffer.update(count * STRIDE * 4);
      container.visible = count > 0;
      return widths;
    },
    place(i, x, y) {
      positions[i * 2] = x;
      positions[i * 2 + 1] = y;
    },
    flush() {
      positionBuffer.update(count * 8);
    },
    setScale(world, cameraScale) {
      chipWorld = world;
      camera = cameraScale;
      const u = uniforms();
      u.uScale = world;
      u.uPx = px();
    },
    destroy() {
      container.destroy({ children: true, context: true });
      geometry.destroy();
      texture.destroy(true);
    },
  };
}
