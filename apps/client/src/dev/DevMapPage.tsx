import { useEffect, useRef, useState } from 'react';

import { loadMap, type MapStatic } from '@hexfront/sim';

import styles from './DevMapPage.module.css';
import { t } from '../i18n/dict.ts';
import { createMapView, type MapView, type MapViewState } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Радиусы для выбора на глаз (DECISIONS 2026-09-24). */
const RADIUS_OPTIONS = [16, 20, 28, 36] as const;
/** Период обновления показаний панели: чаще — лишние перерисовки React. */
const READOUT_MS = 250;

function useMap(id: string): MapStatic | 'loading' | 'error' {
  const [map, setMap] = useState<MapStatic | 'loading' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    fetch(`/maps/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: unknown) => {
        const result = loadMap(json);
        if (!result.ok) throw new Error(result.errors.join('; '));
        if (alive) setMap(result.map);
      })
      .catch((error: unknown) => {
        console.error('dev_map_load_failed', error);
        if (alive) setMap('error');
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return map;
}

/** Страница /dev/map?map=small[&radius=20][&scale=1]: рельеф, камера, выбор радиуса. */
export function DevMapPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const map = useMap(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const stateRef = useRef<MapViewState | null>(null);
  const [radius, setRadius] = useState(Number(params.get('radius')) || tokens.map.hexRadius);
  const [readout, setReadout] = useState<MapViewState | null>(null);
  // Радиус и масштаб из URL нужны только при создании сцены.
  const initial = useRef({ radius, scale: Number(params.get('scale')) });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof map === 'string') return;
    let cancelled = false;
    void createMapView(host, map, initial.current.radius, (s) => (stateRef.current = s)).then(
      (v) => {
        if (cancelled) return v.destroy();
        viewRef.current = v;
        if (initial.current.scale > 0) v.setScale(initial.current.scale);
      },
    );
    const timer = window.setInterval(() => setReadout(stateRef.current), READOUT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [map]);

  const pickRadius = (r: number): void => {
    setRadius(r);
    viewRef.current?.setRadius(r);
  };

  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} data-testid="map-host" />
      <aside className={styles.panel}>
        <h1 className={styles.title}>{t('dev.map.title')}</h1>
        {map === 'loading' && <p>{t('dev.map.loading')}</p>}
        {map === 'error' && <p className={styles.error}>{t('dev.map.error')}</p>}
        <div className={styles.row} role="group" aria-label={t('dev.map.radius')}>
          <span className={styles.label}>{t('dev.map.radius')}</span>
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={r === radius ? styles.chipActive : styles.chip}
              aria-pressed={r === radius}
              onClick={() => pickRadius(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <dl className={styles.stats}>
          <dt>{t('dev.map.scale')}</dt>
          <dd data-testid="scale">{readout ? readout.scale.toFixed(2) : '—'}</dd>
          <dt>{t('dev.map.detail')}</dt>
          <dd data-testid="detail">{readout ? `z${readout.level}` : '—'}</dd>
          <dt>{t('dev.map.fps')}</dt>
          <dd data-testid="fps">{readout ? Math.round(readout.fps) : '—'}</dd>
        </dl>
      </aside>
    </div>
  );
}
