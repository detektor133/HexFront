import { useEffect, useRef, useState } from 'react';

import styles from './Celebration.module.css';
import { tokens } from '../theme/tokens.ts';

/** Что отпраздновать: плашка (если есть текст) и салют цвета игрока. */
export interface CelebrationCue {
  /** Новый ключ — новый праздник; тот же ключ повторно не запускается. */
  readonly key: string;
  readonly text: string | null;
  readonly color: string;
}

const BANNER_MS = 4200;
const FIREWORKS_MS = 3600;
const BURST_EVERY_MS = 380;
const SPARKS = 34;
const GRAVITY = 140;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const SHADES = [tokens.ui.ink, tokens.ui.surface2, tokens.ui.surface];

// Плоские квадратики без свечения и градиентов (стайлгайд): разлетаются из точки и падают.
function burst(width: number, height: number, color: string): Spark[] {
  const cx = width * (0.15 + Math.random() * 0.7);
  const cy = height * (0.12 + Math.random() * 0.4);
  const power = 140 + Math.random() * 160;
  return Array.from({ length: SPARKS }, (_, i) => {
    const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.2;
    const speed = power * (0.55 + Math.random() * 0.45);
    return {
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 3 + Math.random() * 3,
      color: i % 3 === 0 ? (SHADES[i % SHADES.length] ?? color) : color,
    };
  });
}

function Fireworks(props: { readonly color: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = (): void => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    let sparks: Spark[] = [];
    let last = performance.now();
    let lastBurst = last - BURST_EVERY_MS;
    const start = last;
    let frame = 0;
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now - start < FIREWORKS_MS && now - lastBurst >= BURST_EVERY_MS) {
        lastBurst = now;
        sparks.push(...burst(window.innerWidth, window.innerHeight, props.color));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      sparks = sparks.filter((s) => s.life > 0);
      for (const s of sparks) {
        s.vy += GRAVITY * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 1 - 0.8 * dt;
        s.life -= 0.55 * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 1.4));
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
      }
      ctx.globalAlpha = 1;
      if (now - start < FIREWORKS_MS || sparks.length > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [props.color]);
  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}

/**
 * Победа над противником: плашка по центру сверху и салют по экрану. Салют не ловит нажатия,
 * при «меньше движения» остаётся только плашка.
 */
export function Celebration(props: {
  readonly cue: CelebrationCue | null;
}): React.JSX.Element | null {
  const [active, setActive] = useState<CelebrationCue | null>(null);
  const shown = useRef('');
  const cue = props.cue;
  useEffect(() => {
    if (!cue || cue.key === shown.current) return;
    shown.current = cue.key;
    setActive(cue);
    const timer = window.setTimeout(() => setActive(null), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [cue]);
  if (!active) return null;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return (
    <div className={styles.layer} role="status">
      {!calm && <Fireworks key={active.key} color={active.color} />}
      {active.text !== null && (
        <div className={styles.banner} style={{ borderColor: active.color }}>
          {active.text}
        </div>
      )}
    </div>
  );
}
