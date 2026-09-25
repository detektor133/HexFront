// Pixi-сцена карты: слои рельефа и камера с перетаскиванием, колесом, щипком и инерцией.
// ADR-0005: карта рисуется Pixi императивно, React только управляет параметрами.
import { Application, Container } from 'pixi.js';

import type { Hex, MapStatic } from '@hexfront/sim';

import {
  clampCamera,
  decayVelocity,
  detailLevel,
  fitCamera,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
  type DetailLevel,
  type Velocity,
  type Viewport,
} from './camera.ts';
import { hexCenter, mapBounds, pixelToHex, type Point, type Rect } from './hex-geometry.ts';
import { createTerrainLayer, type TerrainLayer } from './terrain-layer.ts';
import { tokens } from '../theme/tokens.ts';

export interface MapViewState {
  readonly scale: number;
  readonly level: DetailLevel;
  readonly fps: number;
}

/** Слой между заливкой рельефа и его узорами (территории, дороги); top — над узорами (города). */
export interface MidLayer {
  readonly container: Container;
  readonly top?: Container;
  update(scale: number, level: DetailLevel): void;
  /** Покадровая анимация (движение фишек, бегущие штрихи); время — performance.now(), мс. */
  frame?(nowMs: number): void;
  destroy(): void;
}

export type MidLayerFactory = (map: MapStatic, radius: number) => MidLayer;

/** Тап выбирает; долгий тап или правая кнопка мыши — приказ (07-controls.md, как в HoI4). */
export type TapKind = 'select' | 'order';

export interface MapViewOptions {
  readonly radius: number;
  readonly midLayer: MidLayerFactory | null;
}

export interface MapView {
  /** Пересобирает слои; камера сохраняет точку карты в центре экрана и масштаб. */
  configure(options: MapViewOptions): void;
  /** Масштаб с центром экрана; для скриншотов и отладки. */
  setScale(scale: number): void;
  /** Ставит гекс в центр экрана (в пределах границ карты). */
  centerOn(hex: Hex): void;
  destroy(): void;
}

interface Pointers {
  readonly active: Map<number, Point>;
  /** Путь указателя с нажатия: короче TAP_SLOP_PX — это тап, а не перетаскивание. */
  travel: number;
  multi: boolean;
  velocity: Velocity | null;
  lastMoveMs: number;
  /** Время нажатия и кнопка — для долгого тапа и правой кнопки. */
  downMs: number;
  button: number;
}

// Скорость для инерции сглаживается по последним событиям перетаскивания.
const VELOCITY_SMOOTHING = 0.8;
/** Если палец замер дольше этого перед отпусканием, инерции нет. */
const INERTIA_MAX_PAUSE_MS = 80;
/** Сдвиг указателя, после которого нажатие считается перетаскиванием, px. */
const TAP_SLOP_PX = 6;

/** Создаёт карту в host и сообщает масштаб, детализацию и fps через onState. */
export async function createMapView(
  host: HTMLElement,
  map: MapStatic,
  initial: MapViewOptions,
  onState: (s: MapViewState) => void,
  onTap?: (hex: Hex, kind: TapKind) => void,
): Promise<MapView> {
  let opts = initial;
  const app = new Application();
  await app.init({
    background: tokens.map.background,
    resizeTo: host,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  });
  host.appendChild(app.canvas);
  const world = new Container();
  app.stage.addChild(world);

  let layer: TerrainLayer = createTerrainLayer(map, opts.radius);
  let mid: MidLayer | null = opts.midLayer?.(map, opts.radius) ?? null;
  const mount = (): void => {
    world.addChild(layer.base);
    if (mid) world.addChild(mid.container);
    world.addChild(layer.overlay);
    if (mid?.top) world.addChild(mid.top);
  };
  mount();
  let bounds: Rect = mapBounds(map.width, map.height, opts.radius);
  const view = (): Viewport => ({ width: app.screen.width, height: app.screen.height });
  let cam: Camera = fitCamera(view(), bounds);
  let drawnScale = 0;
  const ptr: Pointers = {
    active: new Map(),
    velocity: null,
    lastMoveMs: 0,
    travel: 0,
    multi: false,
    downMs: 0,
    button: 0,
  };

  const apply = (): void => {
    world.position.set(Math.round(cam.x), Math.round(cam.y));
    world.scale.set(cam.scale);
    const level = detailLevel(cam.scale);
    if (cam.scale !== drawnScale) {
      layer.update(cam.scale, level);
      mid?.update(cam.scale, level);
      drawnScale = cam.scale;
    }
    onState({ scale: cam.scale, level, fps: app.ticker.FPS });
  };

  app.ticker.add((ticker) => {
    mid?.frame?.(performance.now());
    if (ptr.velocity && ptr.active.size === 0) {
      const v = ptr.velocity;
      cam = panBy(
        cam,
        (v.vx * ticker.deltaMS) / 1000,
        (v.vy * ticker.deltaMS) / 1000,
        view(),
        bounds,
      );
      ptr.velocity = decayVelocity(v, ticker.deltaMS);
    }
    cam = clampCamera(cam, view(), bounds);
    apply();
  });

  const detach = attachInput(app.canvas, ptr, {
    pan: (dx, dy) => (cam = panBy(cam, dx, dy, view(), bounds)),
    zoom: (factor, at) => (cam = zoomAt(cam, factor, at.x, at.y, view(), bounds)),
    tap: (at, kind) => {
      const world = { x: (at.x - cam.x) / cam.scale, y: (at.y - cam.y) / cam.scale };
      onTap?.(pixelToHex(world, opts.radius), kind);
    },
  });

  return {
    configure(next) {
      const centerWorld = {
        x: (view().width / 2 - cam.x) / cam.scale / opts.radius,
        y: (view().height / 2 - cam.y) / cam.scale / opts.radius,
      };
      layer.destroy();
      mid?.destroy();
      opts = next;
      layer = createTerrainLayer(map, opts.radius);
      mid = opts.midLayer?.(map, opts.radius) ?? null;
      mount();
      bounds = mapBounds(map.width, map.height, opts.radius);
      cam = clampCamera(
        {
          scale: cam.scale,
          x: view().width / 2 - centerWorld.x * opts.radius * cam.scale,
          y: view().height / 2 - centerWorld.y * opts.radius * cam.scale,
        },
        view(),
        bounds,
      );
      drawnScale = 0;
    },
    centerOn(hex) {
      const p = hexCenter(hex, opts.radius);
      const v = view();
      cam = clampCamera(
        { scale: cam.scale, x: v.width / 2 - p.x * cam.scale, y: v.height / 2 - p.y * cam.scale },
        v,
        bounds,
      );
    },
    setScale(scale) {
      cam = zoomAt(cam, scale / cam.scale, view().width / 2, view().height / 2, view(), bounds);
    },
    destroy() {
      detach();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

interface InputHandlers {
  pan(dx: number, dy: number): void;
  zoom(factor: number, at: Point): void;
  tap(at: Point, kind: TapKind): void;
}

/** Удержание дольше этого без сдвига — долгий тап (приказ). */
const LONG_PRESS_MS = 450;
const RIGHT_BUTTON = 2;

function attachInput(canvas: HTMLCanvasElement, ptr: Pointers, h: InputHandlers): () => void {
  const local = (e: PointerEvent | WheelEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinch = (): { mid: Point; dist: number } | null => {
    const [a, b] = [...ptr.active.values()];
    if (!a || !b) return null;
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  const down = (e: PointerEvent): void => {
    canvas.setPointerCapture(e.pointerId);
    ptr.active.set(e.pointerId, local(e));
    if (ptr.active.size === 1) {
      ptr.travel = 0;
      ptr.multi = false;
    } else {
      ptr.multi = true;
    }
    ptr.velocity = null;
    ptr.lastMoveMs = e.timeStamp;
    ptr.downMs = e.timeStamp;
    ptr.button = e.button;
  };
  const move = (e: PointerEvent): void => {
    const prev = ptr.active.get(e.pointerId);
    if (!prev) return;
    const before = pinch();
    const p = local(e);
    ptr.active.set(e.pointerId, p);
    const after = pinch();
    if (before && after) {
      h.zoom(after.dist / before.dist, after.mid);
      h.pan(after.mid.x - before.mid.x, after.mid.y - before.mid.y);
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    ptr.travel += Math.hypot(dx, dy);
    h.pan(dx, dy);
    const dt = Math.max(1, e.timeStamp - ptr.lastMoveMs);
    const inst = { vx: (dx / dt) * 1000, vy: (dy / dt) * 1000 };
    const v = ptr.velocity ?? inst;
    const k = VELOCITY_SMOOTHING;
    ptr.velocity = { vx: v.vx * (1 - k) + inst.vx * k, vy: v.vy * (1 - k) + inst.vy * k };
    ptr.lastMoveMs = e.timeStamp;
  };
  const up = (e: PointerEvent): void => {
    const at = ptr.active.get(e.pointerId);
    ptr.active.delete(e.pointerId);
    if (at && ptr.active.size === 0 && !ptr.multi && ptr.travel < TAP_SLOP_PX) {
      const long = e.timeStamp - ptr.downMs >= LONG_PRESS_MS;
      h.tap(at, long || ptr.button === RIGHT_BUTTON ? 'order' : 'select');
    }
    const paused = e.timeStamp - ptr.lastMoveMs > INERTIA_MAX_PAUSE_MS;
    if (ptr.active.size > 0 || paused) ptr.velocity = null;
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    h.zoom(wheelFactor(e.deltaY), local(e));
  };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  // Правая кнопка — приказ, контекстное меню браузера над картой не нужно.
  const noMenu = (e: MouseEvent): void => e.preventDefault();
  canvas.addEventListener('contextmenu', noMenu);
  return () => {
    canvas.removeEventListener('contextmenu', noMenu);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
