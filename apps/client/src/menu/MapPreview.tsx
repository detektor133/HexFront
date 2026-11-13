// Мини-карта выбранной карты со стартовыми точками: клик по свободной точке — «моё место»,
// ещё клик — снова случайное. Занятые другими людьми окрашены цветом игрока.
import { useEffect, useRef, useState } from 'react';

import { hexFromId, loadMap, TERRAIN, type MapStatic } from '@hexfront/sim';

import styles from './map-preview.module.css';
import { mapUrl, type MapRequest } from '../local/map-request.ts';
import { hexCenter } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const WIDTH = 320;
const HEIGHT = 200;
const PAD = 10;
const R = 1;

const LAND: Record<number, string> = {
  [TERRAIN.plains]: tokens.map.terrain.plains,
  [TERRAIN.forest]: tokens.map.terrain.forest,
  [TERRAIN.hills]: tokens.map.terrain.hills,
  [TERRAIN.mountains]: tokens.map.terrain.mountains,
  [TERRAIN.desert]: tokens.map.terrain.desert,
};

interface Layout {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

function layoutOf(map: MapStatic): Layout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let id = 0; id < map.terrain.length; id += 1) {
    if (map.terrain[id] === TERRAIN.water) continue;
    const c = hexCenter(hexFromId(id, map.width), R);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const scale = Math.min(
    (WIDTH - 2 * PAD) / (maxX - minX || 1),
    (HEIGHT - 2 * PAD) / (maxY - minY || 1),
  );
  return {
    scale,
    dx: (WIDTH - (maxX - minX) * scale) / 2 - minX * scale,
    dy: (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale,
  };
}

const at = (layout: Layout, q: number, r: number): { x: number; y: number } => {
  const c = hexCenter({ q, r }, R);
  return { x: c.x * layout.scale + layout.dx, y: c.y * layout.scale + layout.dy };
};

export interface MapPreviewProps {
  readonly request: MapRequest;
  /** Мой выбор и точки, занятые другими людьми (индекс точки → цвет линии). */
  readonly selected: number | null;
  readonly taken: ReadonlyMap<number, string>;
  readonly onPick: (spawn: number | null) => void;
  readonly label: string;
}

/** Рисует сушу и точки старта; загрузка карты — по её адресу, при смене карты рисуется заново. */
export function MapPreview(props: MapPreviewProps): React.JSX.Element {
  const { request } = props;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [map, setMap] = useState<MapStatic | null>(null);
  const url = mapUrl(request);

  useEffect(() => {
    let live = true;
    setMap(null);
    void fetch(url)
      .then((response) => response.json() as Promise<unknown>)
      .then((json) => {
        const loaded = loadMap(json);
        if (live && loaded.ok) setMap(loaded.map);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || map === null) return;
    const layout = layoutOf(map);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const size = Math.max(1.4, layout.scale * 1.55);
    for (let id = 0; id < map.terrain.length; id += 1) {
      const code = map.terrain[id] ?? 0;
      if (code === TERRAIN.water) continue;
      const hex = hexFromId(id, map.width);
      const p = at(layout, hex.q, hex.r);
      ctx.fillStyle = LAND[code] ?? tokens.map.terrain.plains;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
  }, [map]);

  const layout = map === null ? null : layoutOf(map);
  return (
    <div className={styles.preview} style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        className={styles.canvas}
        aria-hidden="true"
      />
      {map !== null &&
        layout !== null &&
        map.spawns.map((spawn, index) => {
          const p = at(layout, spawn.q, spawn.r);
          const mine = props.selected === index;
          const other = props.taken.get(index);
          return (
            <button
              key={index}
              type="button"
              className={`${styles.spawn} ${mine ? styles.mine : ''}`}
              style={{
                left: `${(p.x / WIDTH) * 100}%`,
                top: `${(p.y / HEIGHT) * 100}%`,
                ...(other === undefined ? {} : { backgroundColor: other }),
              }}
              disabled={other !== undefined}
              aria-pressed={mine}
              aria-label={`${props.label} ${index + 1}`}
              onClick={() => props.onPick(mine ? null : index)}
            />
          );
        })}
    </div>
  );
}
