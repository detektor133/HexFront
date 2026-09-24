// Pixi-сцена карты: слои рельефа и камера с перетаскиванием, колесом, щипком и инерцией.
// ADR-0005: карта рисуется Pixi императивно, React только управляет параметрами.
import { Application, Container } from 'pixi.js';

import type { MapStatic } from '@hexfront/sim';

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
import { mapBounds, type Point, type Rect } from './hex-geometry.ts';
import { createTerrainLayer, type TerrainLayer } from './terrain-layer.ts';
import { tokens } from '../theme/tokens.ts';

export interface MapViewState {
  readonly scale: number;
  readonly level: DetailLevel;
  readonly fps: number;
}

export interface MapView {
  setRadius(radius: number): void;
  /** Масштаб с центром экрана; для скриншотов и отладки. */
  setScale(scale: number): void;
  destroy(): void;
}

interface Pointers {
  readonly active: Map<number, Point>;
  velocity: Velocity | null;
  lastMoveMs: number;
}

// Скорость для инерции сглаживается по последним событиям перетаскивания.
const VELOCITY_SMOOTHING = 0.8;
/** Если палец замер дольше этого перед отпусканием, инерции нет. */
const INERTIA_MAX_PAUSE_MS = 80;

/** Создаёт карту в host и сообщает масштаб, детализацию и fps через onState. */
export async function createMapView(
  host: HTMLElement,
  map: MapStatic,
  radius: number,
  onState: (s: MapViewState) => void,
): Promise<MapView> {
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

  let layer: TerrainLayer = createTerrainLayer(map, radius);
  world.addChild(layer.container);
  let bounds: Rect = mapBounds(map.width, map.height, radius);
  const view = (): Viewport => ({ width: app.screen.width, height: app.screen.height });
  let cam: Camera = fitCamera(view(), bounds);
  let drawnScale = 0;
  const ptr: Pointers = { active: new Map(), velocity: null, lastMoveMs: 0 };

  const apply = (): void => {
    world.position.set(Math.round(cam.x), Math.round(cam.y));
    world.scale.set(cam.scale);
    const level = detailLevel(cam.scale);
    if (cam.scale !== drawnScale) {
      layer.update(cam.scale, level);
      drawnScale = cam.scale;
    }
    onState({ scale: cam.scale, level, fps: app.ticker.FPS });
  };

  app.ticker.add((ticker) => {
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
  });

  return {
    setRadius(next) {
      const centerWorld = {
        x: (view().width / 2 - cam.x) / cam.scale / radius,
        y: (view().height / 2 - cam.y) / cam.scale / radius,
      };
      layer.destroy();
      radius = next;
      layer = createTerrainLayer(map, radius);
      world.addChild(layer.container);
      bounds = mapBounds(map.width, map.height, radius);
      // Сохраняем ту же точку карты в центре экрана и тот же масштаб.
      cam = clampCamera(
        {
          scale: cam.scale,
          x: view().width / 2 - centerWorld.x * radius * cam.scale,
          y: view().height / 2 - centerWorld.y * radius * cam.scale,
        },
        view(),
        bounds,
      );
      drawnScale = 0;
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
}

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
    ptr.velocity = null;
    ptr.lastMoveMs = e.timeStamp;
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
    h.pan(dx, dy);
    const dt = Math.max(1, e.timeStamp - ptr.lastMoveMs);
    const inst = { vx: (dx / dt) * 1000, vy: (dy / dt) * 1000 };
    const v = ptr.velocity ?? inst;
    const k = VELOCITY_SMOOTHING;
    ptr.velocity = { vx: v.vx * (1 - k) + inst.vx * k, vy: v.vy * (1 - k) + inst.vy * k };
    ptr.lastMoveMs = e.timeStamp;
  };
  const up = (e: PointerEvent): void => {
    ptr.active.delete(e.pointerId);
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
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
