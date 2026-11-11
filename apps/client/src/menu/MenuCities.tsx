// Вид «Города»: режимы — плашки на настоящих городах живой карты. Нажатие приближает камеру к
// городу («провал»), и панель режима появляется внизу, а не отдельным окном.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ModePanel } from './MenuParts.tsx';
import styles from './menu-variants.module.css';
import { MODE_IDS, modeName, modeSub, type ModeId } from './mode-items.ts';
import type { VariantProps } from './variant-props.ts';

interface Anchor {
  readonly q: number;
  readonly r: number;
}

/** Куда на экране тянется плашка режима (доли экрана); ближайший видимый город берётся якорем. */
const WISH: Record<ModeId, readonly [number, number]> = {
  online: [0.5, 0.42],
  bots: [0.27, 0.72],
  tutorial: [0.74, 0.72],
};

const ZOOM = 1.6;
/** Половина ширины плашки: у края экрана плашка сдвигается, а метка остаётся на городе. */
const PLAQUE_HALF = 85;

export function MenuCities(props: VariantProps): React.JSX.Element {
  const { api } = props;
  const [mode, setMode] = useState<ModeId | null>(null);
  const [anchors, setAnchors] = useState<Partial<Record<ModeId, Anchor>>>({});
  const [positions, setPositions] = useState<
    Partial<Record<ModeId, { x: number; y: number; dx: number }>>
  >({});
  const layerRef = useRef<HTMLDivElement>(null);

  // Якоря: настоящие города карты, ближайшие к желаемым местам экрана и попавшие в кадр.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (api === null || layer === null) return;
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    const seen = api.map.cities
      .map((city) => ({ city, at: api.screenOf(city.q, city.r) }))
      .filter(
        (c): c is { city: (typeof c)['city']; at: { x: number; y: number } } =>
          c.at !== null &&
          c.at.x > w * 0.02 &&
          c.at.x < w * 0.98 &&
          c.at.y > h * 0.24 &&
          c.at.y < h * 0.86,
      );
    const used = new Set<number>();
    const next: Partial<Record<ModeId, Anchor>> = {};
    for (const id of MODE_IDS) {
      const [wx, wy] = WISH[id];
      const best = seen
        .filter((c) => !used.has(c.city.id))
        .sort(
          (a, b) =>
            (a.at.x - wx * w) ** 2 +
            (a.at.y - wy * h) ** 2 -
            ((b.at.x - wx * w) ** 2 + (b.at.y - wy * h) ** 2),
        )[0];
      if (best === undefined) continue;
      used.add(best.city.id);
      next[id] = { q: best.city.q, r: best.city.r };
    }
    setAnchors(next);
  }, [api]);

  const place = useCallback((): void => {
    if (api === null) return;
    const next: Partial<Record<ModeId, { x: number; y: number; dx: number }>> = {};
    const width = layerRef.current?.clientWidth ?? 0;
    for (const id of MODE_IDS) {
      const a = anchors[id];
      const at = a === undefined ? null : api.screenOf(a.q, a.r);
      if (at !== null) {
        const edge = PLAQUE_HALF + 8;
        const dx = at.x < edge ? edge - at.x : at.x > width - edge ? width - edge - at.x : 0;
        next[id] = { ...at, dx };
      }
    }
    setPositions(next);
  }, [api, anchors]);

  useEffect(() => {
    if (api === null) return;
    place();
    let frame = 0;
    const stop = api.onCamera(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    });
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, [api, place]);

  const open = (id: ModeId): void => {
    const a = anchors[id];
    if (api === null || a === undefined) return;
    setMode(id);
    api.flyTo(a.q, a.r, ZOOM, (layerRef.current?.clientHeight ?? 600) * 0.5);
  };
  const close = (): void => {
    setMode(null);
    api?.home();
  };

  return (
    <div ref={layerRef} className={styles.layerFill}>
      {MODE_IDS.map((id) => {
        const at = positions[id];
        if (at === undefined) return null;
        return (
          <button
            key={id}
            type="button"
            className={`${styles.plaque} ${id === 'online' ? styles.main : ''} ${mode !== null && mode !== id ? styles.away : ''}`}
            style={{ left: at.x, top: at.y, '--dx': `${at.dx}px` } as React.CSSProperties}
            onClick={() => open(id)}
          >
            <span className={styles.plaqueBody}>
              <b>{modeName(id)}</b>
              <small>{modeSub(id)}</small>
            </span>
            <span className={styles.stem} />
            <span className={styles.pin} />
          </button>
        );
      })}
      {mode !== null && (
        <div className={styles.floatPanel}>
          <ModePanel
            mode={mode}
            settings={props.settings}
            update={props.update}
            go={props.go}
            onBack={close}
          />
        </div>
      )}
    </div>
  );
}
