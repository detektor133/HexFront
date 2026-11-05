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

/** Касание или мышь: от этого зависит, что написано в подсказке. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
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
}): React.JSX.Element | null {
  const { chapter, camera, hexWorld, hexRadius } = props;
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
        const r = hexRadius * scale * 0.95;
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
        style={{ bottom: 120 }}
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
  // Карточка уходит от цели: цель в верхней половине экрана — карточка внизу, и наоборот.
  const targetInTop = mark !== null && mark.y + mark.h / 2 < window.innerHeight / 2;
  const cardPosition = targetInTop ? { bottom: 132 } : { top: 72 };
  return (
    <>
      {mark && (
        <div
          className={mark.round ? styles.ringRound : styles.ring}
          style={{ left: mark.x, top: mark.y, width: mark.w, height: mark.h }}
          aria-hidden="true"
        />
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
