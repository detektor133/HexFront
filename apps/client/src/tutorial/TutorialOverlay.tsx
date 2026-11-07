import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './TutorialOverlay.module.css';
import { begin, currentStep, markDone, next, settle, type Progress } from './engine.ts';
import { STEPS, type ChapterId, type Target, type TutorialCtx } from './script.ts';
import { stepCopy } from './texts.ts';
import { t } from '../i18n/dict.ts';

/** Метка на экране: прямоугольник или круг вокруг цели подсказки, px страницы. */
interface Mark {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly round: boolean;
}

/** Камера: сколько мировых единиц сдвига считается «двинул карту», доля масштаба — «сменил масштаб». */
const PAN_MIN_FRACTION = 0.04;
const ZOOM_MIN_FRACTION = 0.06;
const POLL_MS = 250;

/** Наименьший диаметр кольца вокруг гекса, px. */
const MIN_RING = 64;

/** Размеры карточки подсказки для выбора места, px. */
const CARD_W = 380;
const CARD_H = 230;
const CARD_TOP = 72;
const CARD_BOTTOM = 132;
const CARD_GAP = 24;

/** Через сколько миллисекунд ожидания шага появляется «Пропустить». */
const SKIP_AFTER_MS = 60_000;

/** Касание или мышь: от этого зависит, что написано в подсказке. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** Куда ставить карточку: угол, где она не закрывает цель (иначе по гекс нельзя было бы нажать). */
function cardPlace(mark: Mark | null): React.CSSProperties {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const height = typeof window === 'undefined' ? 800 : window.innerHeight;
  if (width < CARD_W + 24 * 2) {
    const topHalf = mark !== null && mark.y + mark.h / 2 < height / 2;
    return topHalf ? { bottom: CARD_BOTTOM, left: 12 } : { top: CARD_TOP, left: 12 };
  }
  const corners: readonly {
    readonly style: React.CSSProperties;
    readonly x: number;
    readonly y: number;
  }[] = [
    { style: { top: CARD_TOP, right: 12 }, x: width - CARD_W - 12, y: CARD_TOP },
    { style: { top: CARD_TOP, left: 12 }, x: 12, y: CARD_TOP },
    {
      style: { bottom: CARD_BOTTOM, right: 12 },
      x: width - CARD_W - 12,
      y: height - CARD_BOTTOM - CARD_H,
    },
    { style: { bottom: CARD_BOTTOM, left: 12 }, x: 12, y: height - CARD_BOTTOM - CARD_H },
  ];
  if (mark === null) return { top: CARD_TOP, right: 12 };
  const clear = (c: { readonly x: number; readonly y: number }): boolean =>
    mark.x + mark.w + CARD_GAP < c.x ||
    mark.x - CARD_GAP > c.x + CARD_W ||
    mark.y + mark.h + CARD_GAP < c.y ||
    mark.y - CARD_GAP > c.y + CARD_H;
  return (corners.find(clear) ?? corners[0])?.style ?? { top: CARD_TOP, right: 12 };
}

/** Стрелка над целью (под ней, если цель у верхнего края) указывает на неё. */
function arrowStyle(mark: Mark): React.CSSProperties {
  const above = mark.y > 70;
  return {
    left: mark.x + mark.w / 2 - 15,
    top: above ? mark.y - 46 : mark.y + mark.h + 6,
    transform: above ? undefined : 'rotate(180deg)',
  };
}

/**
 * Подсказки обучения поверх матча-урока: рамка у нужного элемента или гекса, карточка с текстом
 * (отдельно для пальца и мыши) и полоса ожидания. Шаг уходит сам, когда игрок сделал действие;
 * объяснения идут по кнопке «Понятно».
 */
export function TutorialOverlay(props: {
  readonly chapter: ChapterId;
  /** Состояние матча для предикатов; null — матч ещё не пришёл. */
  readonly ctx: Omit<TutorialCtx, 'pans' | 'zooms'> | null;
  /** Видимая область карты в мире и размер её экрана. */
  readonly camera: () => {
    readonly from: { readonly x: number; readonly y: number };
    readonly to: { readonly x: number; readonly y: number };
    readonly screen: DOMRect;
  } | null;
  readonly hexWorld: (hex: number) => { readonly x: number; readonly y: number } | null;
  readonly hexRadius: number;
  /** Шаг сменился: режиссёр урока ведёт соперника по номеру шага. */
  readonly onStage?: (stepId: string) => void;
}): React.JSX.Element | null {
  const { chapter, camera, hexWorld, hexRadius, onStage } = props;
  const [pans, setPans] = useState(0);
  const [zooms, setZooms] = useState(0);
  const last = useRef<{ cx: number; cy: number; w: number } | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [finished, setFinished] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const ctx = useMemo<TutorialCtx | null>(
    () => (props.ctx ? { ...props.ctx, pans, zooms } : null),
    [props.ctx, pans, zooms],
  );
  const touch = useMemo(isTouchDevice, []);

  // Камера: раз в четверть секунды сравниваем видимую область с прошлой.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const cam = camera();
      if (!cam) return;
      const w = cam.to.x - cam.from.x;
      const cx = (cam.from.x + cam.to.x) / 2;
      const cy = (cam.from.y + cam.to.y) / 2;
      const prev = last.current;
      if (prev) {
        if (Math.hypot(cx - prev.cx, cy - prev.cy) > prev.w * PAN_MIN_FRACTION)
          setPans((n) => n + 1);
        if (Math.abs(w - prev.w) > prev.w * ZOOM_MIN_FRACTION) setZooms((n) => n + 1);
      }
      last.current = { cx, cy, w };
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [camera]);

  // Вход в главу и продвижение: уже сделанные шаги пропускаются, незавершённые ждут.
  useEffect(() => {
    if (!ctx || finished) return;
    if (progress === null) {
      setProgress(settle(chapter, begin(chapter, ctx), ctx));
      return;
    }
    const settled = settle(chapter, progress, ctx);
    if (settled.index !== progress.index) setProgress(settled);
  }, [ctx, chapter, progress, finished]);

  const step = progress ? currentStep(chapter, progress.index) : undefined;
  const total = STEPS[chapter].length;
  const stepId = step?.id ?? '';
  useEffect(() => {
    if (stepId !== '') onStage?.(stepId);
  }, [stepId, onStage]);
  // Шаг, который долго не выходит, можно пропустить: урок не должен упираться в тупик.
  const [canSkip, setCanSkip] = useState(false);
  useEffect(() => {
    setCanSkip(false);
    const timer = window.setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [stepId]);
  useEffect(() => {
    if (progress && !step && !finished) {
      markDone(chapter);
      setFinished(true);
    }
  }, [progress, step, finished, chapter]);

  // Метка цели: элемент интерфейса по data-tutorial или гекс карты; пересчитывается на ходу.
  useEffect(() => {
    const target: Target | undefined = step?.target;
    if (!target || !ctx) {
      setMark(null);
      return;
    }
    const compute = (): void => {
      const fromHex = (hex: number | null): Mark | null => {
        const cam = camera();
        const world = hex === null ? null : hexWorld(hex);
        if (!cam || !world) return null;
        const scale = cam.screen.width / (cam.to.x - cam.from.x);
        const r = Math.max(MIN_RING / 2, hexRadius * scale * 1.1);
        return {
          x: cam.screen.left + (world.x - cam.from.x) * scale - r,
          y: cam.screen.top + (world.y - cam.from.y) * scale - r,
          w: 2 * r,
          h: 2 * r,
          round: true,
        };
      };
      if ('ui' in target) {
        const el = document.querySelector(`[data-tutorial="${target.ui}"]`);
        const rect = el?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          setMark({
            x: rect.left - 4,
            y: rect.top - 4,
            w: rect.width + 8,
            h: rect.height + 8,
            round: false,
          });
          return;
        }
        setMark(fromHex(target.fallbackHex?.(ctx) ?? null));
        return;
      }
      setMark(fromHex(target.hex(ctx)));
    };
    compute();
    const timer = window.setInterval(compute, POLL_MS / 2);
    return () => window.clearInterval(timer);
  }, [step, ctx, camera, hexWorld, hexRadius]);

  const exit = (): void => window.location.assign('/');
  if (dismissed) return null;
  if (finished) {
    return (
      <aside
        className={styles.card}
        data-testid="tutorial"
        aria-live="polite"
        style={{ bottom: 120, left: '50%', transform: 'translateX(-50%)' }}
      >
        <h2 className={styles.title}>{t('tutorial.finished')}</h2>
        <p className={styles.text}>{t('tutorial.finishedText')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={exit}>
            {t('tutorial.toMenu')}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setDismissed(true)}>
            {t('tutorial.keepPlaying')}
          </button>
        </div>
      </aside>
    );
  }
  if (!step || !progress || !ctx) return null;
  const copy = stepCopy(chapter, step.id, touch);
  const waiting = step.progress?.(ctx);
  const cardPosition = cardPlace(mark);
  return (
    <>
      {mark && (
        <>
          <div
            className={mark.round ? styles.ringRound : styles.ring}
            style={{ left: mark.x, top: mark.y, width: mark.w, height: mark.h }}
            aria-hidden="true"
          />
          <svg
            className={styles.arrow}
            viewBox="0 0 24 32"
            width="30"
            height="40"
            style={arrowStyle(mark)}
            aria-hidden="true"
          >
            <path d="M12 30 L2 16 H8 V2 H16 V16 H22 Z" />
          </svg>
        </>
      )}
      <aside className={styles.card} style={cardPosition} data-testid="tutorial" aria-live="polite">
        <div className={styles.head}>
          <span className={styles.counter}>{`${progress.index + 1} / ${total}`}</span>
          <button type="button" className={styles.link} onClick={exit}>
            {t('tutorial.exit')}
          </button>
        </div>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.text}>{copy.text}</p>
        {copy.hint && <p className={styles.hint}>{copy.hint}</p>}
        {waiting !== undefined && (
          <div className={styles.bar} role="progressbar" aria-valuenow={Math.round(waiting * 100)}>
            <span className={styles.fill} style={{ width: `${Math.round(waiting * 100)}%` }} />
          </div>
        )}
        {!step.manual && canSkip && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setProgress(next(chapter, progress, ctx))}
            >
              {t('tutorial.skip')}
            </button>
          </div>
        )}
        {step.manual && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => setProgress(next(chapter, progress, ctx))}
            >
              {t('tutorial.gotIt')}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
