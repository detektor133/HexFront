// Pixi-сцена карты: слои рельефа и камера с перетаскиванием, колесом, щипком и инерцией.
// ADR-0005: карта рисуется Pixi императивно, React только управляет параметрами.
import { Application, BigPool, Container, CullerPlugin, extensions, Graphics } from 'pixi.js';

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
import { graphicsTelemetry, type GraphicsTelemetry } from './graphics-telemetry.ts';
import { hexCenter, mapBounds, pixelToHex, type Point, type Rect } from './hex-geometry.ts';
import { createTerrainLayer, type TerrainLayer } from './terrain-layer.ts';
import {
  PREF_INERTIA,
  PREF_ZOOM_SPEED,
  readBoolPref,
  readNumberPref,
} from '../settings/bool-pref.ts';
import { currentBrightness, onBrightness } from '../settings/brightness.ts';
import { tokens } from '../theme/tokens.ts';

export interface MapViewState {
  readonly scale: number;
  readonly level: DetailLevel;
  readonly fps: number;
}

export interface PixiSceneStats {
  readonly objects: number;
  readonly text: number;
  readonly graphics: number;
  readonly graphicsInstructions: readonly number[];
  readonly graphicsDetails: readonly GraphicsTelemetry[];
  readonly textures: number;
  readonly canvasTextTextures: number | null;
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

export function graphicsInstructionCount(graphics: Graphics): number {
  return graphics.context.instructions.length;
}

/** Приказ удержанием (07-controls.md, «Приказ удержанием»): фаза. */
export type HoldPhase = 'start' | 'move' | 'end' | 'cancel';

/** Когда удержание — приказ, где его отмена (фишка выбранных отрядов), наведение мыши. */
export interface OrderHooks {
  canHold(): boolean;
  cancelZone(world: Point): boolean;
  hold(world: Point, phase: HoldPhase, screen?: Point): void;
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
  /** Сдвигает камеру на экранный вектор (меню тянет карту левой кнопкой мыши). */
  pan(dx: number, dy: number): void;
  /** Оставляет нижнюю панель вне области, к которой привязаны границы камеры. */
  setBottomInset(px: number): void;
  /** Оставляет HUD вне области, к которой привязаны границы камеры. */
  setTopInset(px: number, rightInset?: number): void;
  /** Ставит гекс в центр экрана (в пределах границ карты). */
  centerOn(hex: Hex, durationMs?: number): void;
  /**
   * Ставит гекс в центр и держит его там, пока игрок не сдвинет камеру сам: панели HUD и размер
   * окна приходят после первого кадра и сдвигают середину видимой области.
   */
  pinCenter(hex: Hex): void;
  /**
   * Режим рисования: один палец или ЛКМ с зажатием ведут линию, два пальца, колесо и
   * перетаскивание правой/средней кнопкой двигают карту; null — обычный режим.
   */
  setStroke(handler: StrokeHandler | null): void;
  /** Рамка выбора отрядов мышью после сдвига ЛКМ за порог жеста. */
  setSelection(handler: SelectionHandler | null): void;
  /**
   * Захват: при нажатии grab(world) может вернуть обработчик росчерка — тогда этот жест тянет
   * объект (ручку конца фронта), а не карту.
   */
  setGrab(grab: ((world: Point) => StrokeHandler | null) | null): void;
  /** Приказ удержанием и наведение мыши. */
  setOrderHooks(hooks: OrderHooks | null): void;
  /** Видимая область карты в мировых координатах. */
  visibleWorldRect?(): { readonly from: Point; readonly to: Point };
  /** Подписка на сдвиг и масштаб камеры: плашки на карте идут за ней без опроса; возвращает отписку. */
  onCamera(listener: () => void): () => void;
  /** Отменяет текущий жест и его прогноз. */
  cancel(): void;
  /** Счётчики Pixi для dev-телеметрии; не участвуют в отрисовке и симуляции. */
  sceneStats(): PixiSceneStats;
  destroy(): void;
}

// Скорость для инерции сглаживается по последним событиям перетаскивания.
const VELOCITY_SMOOTHING = 0.8;
/** Если палец замер дольше этого перед отпусканием, инерции нет. */
const INERTIA_MAX_PAUSE_MS = 80;

/** Как часто отпускаются свободные элементы пула Pixi, мс. */
const POOL_CLEAR_MS = 15_000;

/** Плагин отсечения подключается один раз на страницу, а не на каждую карту. */
let cullerAdded = false;

/** Как часто пересчитываются слои карты, пока меняется масштаб, мс. */
const MID_THROTTLE_MS = 100;

/** Создаёт карту в host и сообщает масштаб, детализацию и fps через onState. */
export async function createMapView(
  host: HTMLElement,
  map: MapStatic,
  initial: MapViewOptions,
  onState: (s: MapViewState) => void,
  onTap?: (hex: Hex, kind: TapKind, world: Point, shift: boolean, screen: Point) => void,
  onDoubleTap?: (hex: Hex, world: Point) => void,
): Promise<MapView> {
  let opts = initial;
  // Фишки вне экрана не рисуются: в большой войне их сотни, а на экране — десятки.
  if (!cullerAdded) {
    extensions.add(CullerPlugin);
    cullerAdded = true;
  }
  const app = new Application();
  // Телефон: разрешение не выше 2 и без MSAA — шейдеры карты сглаживают края сами, а лишние
  // пиксели на слабом GPU дороже всего.
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  await app.init({
    background: tokens.map.water,
    resizeTo: host,
    antialias: !touch,
    autoDensity: true,
    resolution: touch ? Math.min(2, window.devicePixelRatio) : window.devicePixelRatio,
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);
  const selectionFrame = host.ownerDocument?.createElement('div');
  if (selectionFrame) {
    selectionFrame.dataset.testid = 'selection-frame';
    selectionFrame.setAttribute('aria-hidden', 'true');
    Object.assign(selectionFrame.style, {
      position: 'absolute',
      display: 'none',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      border: `${tokens.selection.width}px solid ${tokens.selection.color}`,
      backgroundColor: `color-mix(in srgb, ${tokens.selection.color} 8%, transparent)`,
    });
    host.appendChild(selectionFrame);
  }
  const clearSelectionFrame = (): void => {
    if (selectionFrame) selectionFrame.style.display = 'none';
  };
  const world = new Container();
  app.stage.addChild(world);

  // Яркость карты: затемнение (или подсветка) лежит над рельефом и территориями, но под отрядами,
  // подписями и планами — фильтр на весь холст гасил бы и фишки.
  const dimmer = new Graphics();
  let layer: TerrainLayer = createTerrainLayer(map, opts.radius);
  let mid: MidLayer | null = opts.midLayer?.(map, opts.radius) ?? null;
  const mount = (): void => {
    world.addChild(layer.base);
    if (mid) world.addChild(mid.container);
    world.addChild(layer.overlay);
    world.addChild(dimmer);
    if (mid?.top) world.addChild(mid.top);
  };
  mount();
  let bounds: Rect = mapBounds(map.width, map.height, opts.radius);
  const redrawDimmer = (): void => {
    const percent = currentBrightness();
    dimmer.clear();
    dimmer.visible = percent !== 100;
    if (percent === 100) return;
    // Ярче 100 % — белая добавка, темнее — чёрная прозрачная пелена.
    const brighter = percent > 100;
    dimmer.blendMode = brighter ? 'add' : 'normal';
    dimmer.rect(bounds.x, bounds.y, bounds.width, bounds.height).fill({
      color: brighter ? 0xffffff : 0x000000,
      alpha: brighter ? ((percent - 100) / 100) * 0.6 : 1 - percent / 100,
    });
  };
  redrawDimmer();
  const stopBrightness = onBrightness(redrawDimmer);
  const view = (): Viewport => ({ width: app.screen.width, height: app.screen.height });
  let topInset = 0;
  let bottomInset = 0;
  let rightInset = 0;
  const cameraView = (): Viewport => ({
    ...insetViewport(view(), topInset, bottomInset),
    width: Math.max(0, view().width - rightInset),
  });
  let cam: Camera = fitCamera(cameraView(), bounds);
  let drawnScale = 0;
  let velocity: Velocity | null = null;
  let centerAnimation: { from: Camera; to: Camera; elapsedMs: number; durationMs: number } | null =
    null;
  let pressed = 0;
  let pinned: Hex | null = null;
  let seenSize = '';
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

  const cameraListeners = new Set<() => void>();
  let lastMidMs = 0;
  let lastLayerScale = 0;
  const apply = (): void => {
    world.position.set(Math.round(cam.x), Math.round(cam.y));
    world.scale.set(cam.scale);
    for (const listener of cameraListeners) listener();
    const level = detailLevel(cam.scale);
    // Щипок и колесо меняют масштаб каждый кадр, а перестройка слоёв (фишки, подписи) дорогая:
    // пока масштаб движется, слои обновляются не чаще раза в MID_THROTTLE_MS, остальное время
    // картинку масштабирует сам контейнер. Когда жест кончился, следующий же кадр дорисует точно.
    const now = performance.now();
    const moving = cam.scale !== lastLayerScale;
    lastLayerScale = cam.scale;
    const due = !moving || now - lastMidMs >= MID_THROTTLE_MS;
    if (due) layer.update(cam.scale, level);
    if (cam.scale !== drawnScale && due) {
      mid?.update(cam.scale, level);
      drawnScale = cam.scale;
      lastMidMs = now;
    }
    onState({ scale: cam.scale, level, fps: app.ticker.FPS });
  };

  const centerTo = (hex: Hex, durationMs = 0): void => {
    const p = hexCenter(hex, opts.radius);
    const v = cameraView();
    const target = clampCamera(
      {
        scale: cam.scale,
        x: v.width / 2 - p.x * cam.scale,
        y: (v.top ?? 0) + v.height / 2 - p.y * cam.scale,
      },
      cameraView(),
      bounds,
    );
    centerAnimation = durationMs > 0 ? { from: cam, to: target, elapsedMs: 0, durationMs } : null;
    if (durationMs <= 0) cam = target;
  };

  app.ticker.add((ticker) => {
    mid?.frame?.(performance.now());
    const size = `${view().width}x${view().height}`;
    if (size !== seenSize) {
      seenSize = size;
      if (pinned) centerTo(pinned);
    }
    if (centerAnimation) {
      centerAnimation.elapsedMs += ticker.deltaMS;
      const progress = Math.min(1, centerAnimation.elapsedMs / centerAnimation.durationMs);
      cam = {
        scale:
          centerAnimation.from.scale +
          (centerAnimation.to.scale - centerAnimation.from.scale) * progress,
        x: centerAnimation.from.x + (centerAnimation.to.x - centerAnimation.from.x) * progress,
        y: centerAnimation.from.y + (centerAnimation.to.y - centerAnimation.from.y) * progress,
      };
      if (progress >= 1) centerAnimation = null;
    }
    if (velocity && !readBoolPref(PREF_INERTIA, true)) velocity = null;
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
        pinned = null;
        centerAnimation = null;
        cam = panBy(cam, e.dx, e.dy, cameraView(), bounds);
        const now = performance.now();
        const dt = Math.max(1, now - lastPanMs);
        const inst = { vx: (e.dx / dt) * 1000, vy: (e.dy / dt) * 1000 };
        const v = velocity ?? inst;
        const k = VELOCITY_SMOOTHING;
        velocity = { vx: v.vx * (1 - k) + inst.vx * k, vy: v.vy * (1 - k) + inst.vy * k };
        lastPanMs = now;
      } else if (e.t === 'zoom') {
        pinned = null;
        centerAnimation = null;
        cam = zoomAt(cam, e.factor, e.at.x, e.at.y, cameraView(), bounds);
      } else if (e.t === 'tap') {
        const world = toWorld(e.at);
        onTap?.(pixelToHex(world, opts.radius), e.kind, world, e.shift, e.at);
      } else if (e.t === 'selection') {
        const from = toWorld(e.at);
        const to = toWorld(e.to);
        if (selectionFrame && e.phase !== 'end' && e.phase !== 'cancel') {
          selectionFrame.style.display = 'block';
          selectionFrame.style.left = `${Math.min(e.at.x, e.to.x)}px`;
          selectionFrame.style.top = `${Math.min(e.at.y, e.to.y)}px`;
          selectionFrame.style.width = `${Math.abs(e.to.x - e.at.x)}px`;
          selectionFrame.style.height = `${Math.abs(e.to.y - e.at.y)}px`;
        } else if (selectionFrame) {
          clearSelectionFrame();
        }
        selectionHandler?.(from, to, e.phase);
      } else if (e.t === 'stroke') {
        stroking = e.phase === 'start' || e.phase === 'move';
        (grabbed ?? stroke)?.(toWorld(e.at), e.phase);
        if (e.phase === 'end' || e.phase === 'cancel') grabbed = null;
      } else if (e.t === 'hold') {
        velocity = null;
        hooks?.hold(toWorld(e.at), e.phase, e.at);
      } else if (e.t === 'doubleTap') {
        const world = toWorld(e.at);
        onDoubleTap?.(pixelToHex(world, opts.radius), world);
      } else {
        hooks?.hover(e.at ? toWorld(e.at) : null);
      }
    },
  );
  const detach = attachInput(app.canvas, gesture, {
    zoom: (factor, at) => {
      pinned = null;
      // Плавный перелёт камеры к цели иначе возвращал бы масштаб и положение каждый кадр.
      centerAnimation = null;
      cam = zoomAt(cam, factor, at.x, at.y, cameraView(), bounds);
    },
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
  // Пул Pixi хранит отработавшие пакеты графики вместе с их буферами и сам не худеет: после тяжёлой
  // сцены в нём оставались десятки тысяч пакетов и сотни мегабайт (снимок кучи). Свободные
  // элементы пула отпускаем раз в POOL_CLEAR_MS; занятые не затрагиваются.
  const poolTimer = setInterval(() => BigPool?.clear(), POOL_CLEAR_MS);

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
      redrawDimmer();
      cam = clampCamera(
        {
          scale: cam.scale,
          x: cameraView().width / 2 - centerWorld.x * opts.radius * cam.scale,
          y:
            (cameraView().top ?? 0) +
            cameraView().height / 2 -
            centerWorld.y * opts.radius * cam.scale,
        },
        cameraView(),
        bounds,
      );
      drawnScale = 0;
    },
    centerOn(hex, durationMs = 0) {
      pinned = null;
      centerTo(hex, durationMs);
    },
    pinCenter(hex) {
      pinned = hex;
      centerTo(hex);
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
      clearSelectionFrame();
    },
    onCamera(listener) {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    visibleWorldRect() {
      const size = view();
      return { from: toWorld({ x: 0, y: 0 }), to: toWorld({ x: size.width, y: size.height }) };
    },
    sceneStats() {
      const graphicsInstructions: number[] = [];
      const graphicsDetails: GraphicsTelemetry[] = [];
      const counts = { objects: 0, text: 0, graphics: 0 };
      const visit = (node: Container): void => {
        counts.objects += 1;
        if (node.constructor.name === 'Text') counts.text += 1;
        if (node instanceof Graphics) {
          counts.graphics += 1;
          const details = graphicsTelemetry(node, performance.now());
          graphicsInstructions.push(details.instructions);
          graphicsDetails.push(details);
        }
        node.children.forEach(visit);
      };
      visit(app.stage);
      const renderer = app.renderer as unknown as {
        texture: { managedTextures: readonly unknown[] };
        canvasText?: { _activeTextures?: Readonly<Record<string, unknown>> };
      };
      return {
        ...counts,
        graphicsInstructions,
        graphicsDetails,
        textures: renderer.texture.managedTextures.length,
        // Все ключи, а не только живые: Pixi обнуляет освобождённые записи, но не стирает ключи,
        // и рост этого числа показывает, что тексты создаются заново вместо переиспользования.
        canvasTextTextures: renderer.canvasText?._activeTextures
          ? Object.keys(renderer.canvasText._activeTextures).length
          : null,
      };
    },
    setStroke(handler) {
      if (stroking) stroke?.({ x: 0, y: 0 }, 'cancel');
      stroking = false;
      stroke = handler;
    },
    setSelection(handler) {
      selectionHandler = handler;
      clearSelectionFrame();
    },
    pan(dx, dy) {
      centerAnimation = null;
      cam = panBy(cam, dx, dy, cameraView(), bounds);
      apply();
    },
    setScale(scale) {
      const v = cameraView();
      cam = zoomAt(cam, scale / cam.scale, v.width / 2, v.height / 2, v, bounds);
    },
    setBottomInset(px) {
      bottomInset = Math.max(0, px);
      if (pinned) centerTo(pinned);
      cam = clampCamera(cam, cameraView(), bounds);
      apply();
    },
    setTopInset(px, right = rightInset) {
      topInset = Math.max(0, px);
      rightInset = Math.max(0, right);
      if (pinned) centerTo(pinned);
      cam = clampCamera(cam, cameraView(), bounds);
      apply();
    },
    destroy() {
      clearInterval(poolTimer);
      stopBrightness();
      detach();
      selectionFrame?.remove();
      app.destroy({ removeView: true }, { children: true, context: true });
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
export function attachInput(canvas: HTMLCanvasElement, g: Gesture, h: InputHandlers): () => void {
  const local = (e: PointerEvent | WheelEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let count = 0;
  /** Нажатые указатели: отпускание считается один раз, как бы оно ни пришло (pointerup, потеря захвата). */
  const pressed = new Set<number>();
  const down = (e: PointerEvent): void => {
    pressed.add(e.pointerId);
    canvas.setPointerCapture(e.pointerId);
    count += 1;
    h.pressed(count);
    g.down(
      e.pointerId,
      local(e),
      e.button,
      performance.now(),
      e.shiftKey,
      e.pointerType === 'mouse',
    );
  };
  const move = (e: PointerEvent): void => {
    if (count === 0) return g.hover(local(e));
    if (e.pointerType === 'mouse' && e.buttons === 0) return up(e);
    g.move(e.pointerId, local(e), performance.now());
  };
  // Кнопку могли отпустить мимо холста или так, что браузер (Opera при правой кнопке с меню) не прислал
  // pointerup: без этого жест тянул бы карту дальше. Движение без нажатых кнопок и потеря захвата —
  // это тоже отпускание.
  const up = (e: PointerEvent): void => {
    if (!pressed.delete(e.pointerId)) return;
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
    h.zoom(wheelFactor(e.deltaY, readNumberPref(PREF_ZOOM_SPEED, 1)), local(e));
  };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
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
    canvas.removeEventListener('lostpointercapture', up);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('wheel', wheel);
  };
}
