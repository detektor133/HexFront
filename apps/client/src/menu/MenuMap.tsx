// Главное меню как карта: каждая «страна» — кнопка режима, нарисованная теми же гексами и
// границами, что и территории в игре.
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './MenuMap.module.css';
import {
  LANDSCAPE,
  PORTRAIT,
  STRIP,
  boundsOf,
  shapeOf,
  type MenuLayout,
  type TerritoryId,
} from './territories.ts';

export interface MenuTerritory {
  readonly id: TerritoryId;
  readonly label: string;
  readonly sub: string;
  /** Цвет заливки (CSS) и цвет текста на нём. */
  readonly fill: string;
  readonly ink: string;
  readonly onActivate: () => void;
}

/** Портрет — вертикальная раскладка, очень широкий низкий экран — полоса, остальное — широкая. */
function pickLayout(width: number, height: number): MenuLayout {
  if (height > width * 1.05) return PORTRAIT;
  return width > height * 1.9 ? STRIP : LANDSCAPE;
}

export function MenuMap(props: {
  readonly territories: readonly MenuTerritory[];
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<MenuLayout>(() =>
    pickLayout(window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const update = (): void => setLayout(pickLayout(wrap.clientWidth, wrap.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(() => boundsOf(layout), [layout]);
  const shapes = useMemo(
    () => layout.items.map((item) => ({ item, shape: shapeOf(item.cells) })),
    [layout],
  );

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <svg
        className={styles.svg}
        viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {shapes.map(({ item, shape }) => {
          const territory = props.territories.find((t) => t.id === item.id);
          if (territory === undefined) return null;
          return (
            <g
              key={item.id}
              className={styles.territory}
              role="button"
              tabIndex={0}
              aria-label={`${territory.label}. ${territory.sub}`}
              onClick={territory.onActivate}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  territory.onActivate();
                }
              }}
            >
              {shape.polygons.map((points) => (
                <polygon
                  key={points}
                  className={styles.cell}
                  points={points}
                  style={{ fill: territory.fill }}
                />
              ))}
              <path className={styles.border} d={shape.border} />
              <text
                className={styles.title}
                x={shape.label.x}
                y={shape.label.y - item.size * 0.1}
                fontSize={item.size}
                style={{ fill: territory.ink }}
              >
                {territory.label}
              </text>
              <text
                className={styles.sub}
                x={shape.label.x}
                y={shape.label.y + item.size * 0.7}
                fontSize={item.size * 0.72}
                style={{ fill: territory.ink }}
              >
                {territory.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
