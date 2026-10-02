// Pixi-сцена карты: слои рельефа и камера с перетаскиванием, колесом, щипком и инерцией.
// ADR-0005: карта рисуется Pixi императивно, React только управляет параметрами.
import { Application, Container, Graphics } from 'pixi.js';

import type { Hex, MapStatic } from '@hexfront/sim';

import {
  clampCamera,
  decayVelocity,
  detailLevel,
  fitCamera,
  insetViewport,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
  type DetailLevel,
  type Velocity,
  type Viewport,
} from './camera.ts';
import { createGesture, type Gesture, type StrokePhase, type TapKind } from './gesture.ts';
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

export type { StrokePhase, TapKind } from './gesture.ts';

/** Приказ удержанием (07-controls.md, «Приказ удержанием»): фаза. */
export type HoldPhase = 'start' | 'move' | 'end' | 'cancel';

/** Когда удержание — приказ, где его отмена (фишка выбранных отрядов), наведение мыши. */
export interface OrderHooks {
  canHold(): boolean;
  cancelZone(world: Point): boolean;
  hold(world: Point, phase: HoldPhase): void;
  /** Сбрасывает прогноз приказа при нажатии Esc. */
  cancel(): void;
  /** Мышь над картой без нажатия (ПК: прогноз при наведении); null — ушла с карты. */
  hover(world: Point | null): void;
}

/** Росчерк: точка в мировых координатах карты. */
export type StrokeHandler = (world: Point, phase: StrokePhase) => void;
export type SelectionHandler = (from: Point, to: Point, phase: StrokePhase) => void;

export interface MapViewOptions {
  readonly radius: number;
  readonly midLayer: MidLayerFactory | null;
}

export interface MapView {
  /** Пересобирает слои; камера сохраняет точку карты в центре экрана и масштаб. */
  configure(options: MapViewOptions): void;
  /** Масштаб с центром экрана; для скриншотов и отладки. */
  setScale(scale: number): void;
  /** Оставляет нижнюю панель вне области, к которой привязаны границы камеры. */
  setBottomInset(px: number): void;
  /** Ставит гекс в центр экрана (в пределах границ карты). */
  centerOn(hex: Hex): void;
  /**
   * Режим рисования: один палец или ЛКМ с зажатием ведут линию, два пальца, колесо и
   * перетаскивание правой/средней кнопкой двигают карту; null — обычный режим.
   */
  setStroke(handler: StrokeHandler | null): void;
  /** Рамка выбора отрядов мышью; вызывается только для Shift + ЛКМ. */
  setSelection(handler: SelectionHandler | null): void;
  /**
   * Захват: при нажатии grab(world) может вернуть обработчик росчерка — тогда этот жест тянет
   * объект (ручку конца фронта), а не карту.
   */
  setGrab(grab: ((world: Point) => StrokeHandler | null) | null): void;
  /** Приказ удержанием и наведение мыши. */
  setOrderHooks(hooks: OrderHooks | null): void;
  /** Отменяет текущий жест и его прогноз. */
  cancel(): void;
  destroy(): void;
}

// Скорость для инерции сглаживается по последним событиям перетаскивания.
const VELOCITY_SMOOTHING = 0.8;
/** Если палец замер дольше этого перед отпусканием, инерции нет. */
const INERTIA_MAX_PAUSE_MS = 80;

/** Создаёт карту в host и сообщает масштаб, детализацию и fps через onState. */
export async function createMapView(
  host: HTMLElement,
  map: MapStatic,
  initial: MapViewOptions,
  onState: (s: MapViewState) => void,
  onTap?: (hex: Hex, kind: TapKind, world: Point) => void,
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
  const selection = new Graphics();
  world.addChild(selection);

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
  let bottomInset = 0;
  const cameraView = (): Viewport => insetViewport(view(), bottomInset);
  let cam: Camera = fitCamera(cameraView(), bounds);
  let drawnScale = 0;
  let velocity: Velocity | null = null;
  let pressed = 0;
  let stroking = false;
  let hooks: OrderHooks | null = null;
  let stroke: StrokeHandler | null = null;
  let selectionHandler: SelectionHandler | null = null;
  let grab: ((world: Point) => StrokeHandler | null) | null = null;
  let grabbed: StrokeHandler | null = null;
  const toWorld = (at: Point): Point => ({
    x: (at.x - cam.x) / cam.scale,
    y: (at.y - cam.y) / cam.scale,
  });

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
    if (velocity && pressed === 0) {
      const v = velocity;
      cam = panBy(
        cam,
        (v.vx * ticker.deltaMS) / 1000,
        (v.vy * ticker.deltaMS) / 1000,
        cameraView(),
        bounds,
      );
      velocity = decayVelocity(v, ticker.deltaMS);
    }
    cam = clampCamera(cam, cameraView(), bounds);
    apply();
  });

  let lastPanMs = 0;
  const gesture = createGesture(
    {
      drawing: () => grabbed !== null || stroke !== null,
      press: (at) => {
        grabbed = grab?.(toWorld(at)) ?? null;
      },
      release: () => {
        grabbed = null;
      },
      canHold: () => stroke === null && (hooks?.canHold() ?? false),
      cancelZone: (at) => hooks?.cancelZone(toWorld(at)) ?? false,
      inside: (at) => at.x >= 0 && at.y >= 0 && at.x <= view().width && at.y <= view().height,
    },
    (e) => {
      if (e.t === 'pan') {
        cam = panBy(cam, e.dx, e.dy, cameraView(), bounds);
        const now = performance.now();
        const dt = Math.max(1, now - lastPanMs);
        const inst = { vx: (e.dx / dt) * 1000, vy: (e.dy / dt) * 1000 };
        const v = velocity ?? inst;
        const k = VELOCITY_SMOOTHING;
        velocity = { vx: v.vx * (1 - k) + inst.vx * k, vy: v.vy * (1 - k) + inst.vy * k };
        lastPanMs = now;
      } else if (e.t === 'zoom') {
        cam = zoomAt(cam, e.factor, e.at.x, e.at.y, cameraView(), bounds);
      } else if (e.t === 'tap') {
        const world = toWorld(e.at);
        onTap?.(pixelToHex(world, opts.radius), e.kind, world);
      } else if (e.t === 'selection') {
        const from = toWorld(e.at);
        const to = toWorld(e.to);
        selection.clear();
        if (e.phase !== 'end' && e.phase !== 'cancel') {
          selection
            .rect(
              Math.min(from.x, to.x),
              Math.min(from.y, to.y),
              Math.abs(to.x - from.x),
              Math.abs(to.y - from.y),
            )
            .fill({ color: tokens.selection.color, alpha: 0.08 })
            .stroke({ color: tokens.selection.color, width: tokens.selection.width / cam.scale });
        }
        selectionHandler?.(from, to, e.phase);
      } else if (e.t === 'stroke') {
        stroking = e.phase === 'start' || e.phase === 'move';
        (grabbed ?? stroke)?.(toWorld(e.at), e.phase);
        if (e.phase === 'end' || e.phase === 'cancel') grabbed = null;
      } else if (e.t === 'hold') {
        velocity = null;
        hooks?.hold(toWorld(e.at), e.phase);
      } else {
        hooks?.hover(e.at ? toWorld(e.at) : null);
      }
    },
  );
  const detach = attachInput(app.canvas, gesture, {
    zoom: (factor, at) => (cam = zoomAt(cam, factor, at.x, at.y, cameraView(), bounds)),
    pressed: (n) => {
      pressed = n;
      if (n > 0) velocity = null;
    },
    idle: (ms) => {
      if (performance.now() - lastPanMs > ms) velocity = null;
    },
  });
  // Удержание засчитывается и без движения пальца — проверка каждый кадр.
  app.ticker.add(() => gesture.tick(performance.now()));

  return {
    configure(next) {
      const centerWorld = {
        x: (cameraView().width / 2 - cam.x) / cam.scale / opts.radius,
        y: (cameraView().height / 2 - cam.y) / cam.scale / opts.radius,
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
          x: cameraView().width / 2 - centerWorld.x * opts.radius * cam.scale,
          y: cameraView().height / 2 - centerWorld.y * opts.radius * cam.scale,
        },
        cameraView(),
        bounds,
      );
      drawnScale = 0;
    },
    centerOn(hex) {
      const p = hexCenter(hex, opts.radius);
      const v = cameraView();
      cam = clampCamera(
        { scale: cam.scale, x: v.width / 2 - p.x * cam.scale, y: v.height / 2 - p.y * cam.scale },
        cameraView(),
        bounds,
      );
    },
    setGrab(fn) {
      grab = fn;
    },
    setOrderHooks(h) {
      hooks = h;
    },
    cancel() {
      gesture.cancel();
      velocity = null;
      grabbed = null;
      stroking = false;
      hooks?.cancel();
      selection.clear();
    },
    setStroke(handler) {
      if (stroking) stroke?.({ x: 0, y: 0 }, 'cancel');
      stroking = false;
      stroke = handler;
    },
    setSelection(handler) {
      selectionHandler = handler;
      selection.clear();
    },
    setScale(scale) {
      const v = cameraView();
      cam = zoomAt(cam, scale / cam.scale, v.width / 2, v.height / 2, v, bounds);
    },
    setBottomInset(px) {
      bottomInset = Math.max(0, px);
      cam = clampCamera(cam, cameraView(), bounds);
      apply();
    },
    destroy() {
      detach();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

interface InputHandlers {
  zoom(factor: number, at: Point): void;
  /** Сколько указателей нажато (инерция — только когда ни одного). */
  pressed(n: number): void;
  /** Палец отпущен после паузы дольше ms — инерции нет. */
  idle(ms: number): void;
}

// DOM-события указателя → машина жестов (render/gesture.ts); колесо — зум.
function attachInput(canvas: HTMLCanvasElement, g: Gesture, h: InputHandlers): () => void {
  const local = (e: PointerEvent | WheelEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let count = 0;
  const down = (e: PointerEvent): void => {
    canvas.setPointerCapture(e.pointerId);
    count += 1;
    h.pressed(count);
    g.down(e.pointerId, local(e), e.button, performance.now(), e.shiftKey);
  };
  const move = (e: PointerEvent): void => {
    if (count === 0) return g.hover(local(e));
    g.move(e.pointerId, local(e), performance.now());
  };
  const up = (e: PointerEvent): void => {
    count = Math.max(0, count - 1);
    g.up(e.pointerId, local(e), performance.now());
    h.pressed(count);
    if (count === 0) h.idle(INERTIA_MAX_PAUSE_MS);
  };
  const leave = (): void => {
    if (count === 0) g.hover(null);
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
  canvas.addEventListener('pointerleave', leave);
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
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
  };
}
