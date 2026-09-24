import { useEffect, useRef, useState } from 'react';

import { loadMap, type MapStatic } from '@hexfront/sim';

import styles from './DevMapPage.module.css';
import { createFakeTerritories } from './fake-territories.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import {
  createMapView,
  type MapView,
  type MapViewOptions,
  type MapViewState,
} from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Радиусы для выбора на глаз (DECISIONS 2026-09-24). */
const RADIUS_OPTIONS = [16, 20, 28, 36] as const;
/** Период обновления показаний панели: чаще — лишние перерисовки React. */
const READOUT_MS = 250;

const { terrain: T } = tokens.map;
const LEGEND: readonly { color: string; label: MessageKey }[] = [
  { color: tokens.map.water, label: 'terrain.water' },
  { color: T.plains, label: 'terrain.plains' },
  { color: T.forest, label: 'terrain.forest' },
  { color: T.hills, label: 'terrain.hills' },
  { color: T.mountains, label: 'terrain.mountains' },
  { color: T.desert, label: 'terrain.desert' },
];

interface Settings {
  readonly radius: number;
  readonly territories: boolean;
}

function readSettings(params: URLSearchParams): Settings {
  return {
    radius: Number(params.get('radius')) || tokens.map.hexRadius,
    territories: params.get('territories') === '1',
  };
}

function toOptions(s: Settings): MapViewOptions {
  return {
    radius: s.radius,
    midLayer: s.territories ? (map, radius) => createFakeTerritories(map, radius) : null,
  };
}

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

function Choice<T extends string | number | boolean>(props: {
  label: string;
  options: readonly T[];
  value: T;
  format: (v: T) => string;
  onPick: (v: T) => void;
}): React.JSX.Element {
  return (
    <div className={styles.row} role="group" aria-label={props.label}>
      <span className={styles.label}>{props.label}</span>
      {props.options.map((o) => (
        <button
          key={String(o)}
          type="button"
          className={o === props.value ? styles.chipActive : styles.chip}
          aria-pressed={o === props.value}
          onClick={() => props.onPick(o)}
        >
          {props.format(o)}
        </button>
      ))}
    </div>
  );
}

/** /dev/map?map=small[&radius&scale&territories=1&panel=0]. */
export function DevMapPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const map = useMap(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const stateRef = useRef<MapViewState | null>(null);
  const [settings, setSettings] = useState<Settings>(() => readSettings(params));
  const [readout, setReadout] = useState<MapViewState | null>(null);
  // Масштаб из URL и стартовые настройки нужны только при создании сцены.
  const initial = useRef({ settings, scale: Number(params.get('scale')) });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof map === 'string') return;
    let cancelled = false;
    const onState = (s: MapViewState): void => {
      stateRef.current = s;
    };
    void createMapView(host, map, toOptions(initial.current.settings), onState).then((v) => {
      if (cancelled) return v.destroy();
      viewRef.current = v;
      if (initial.current.scale > 0) v.setScale(initial.current.scale);
    });
    const timer = window.setInterval(() => setReadout(stateRef.current), READOUT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [map]);

  const update = (patch: Partial<Settings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    viewRef.current?.configure(toOptions(next));
  };

  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} data-testid="map-host" />
      {/* panel=0 — чистая карта для скриншотов: местность должна узнаваться без легенды. */}
      <aside className={styles.panel} hidden={params.get('panel') === '0'}>
        <h1 className={styles.title}>{t('dev.map.title')}</h1>
        {map === 'loading' && <p>{t('dev.map.loading')}</p>}
        {map === 'error' && <p className={styles.error}>{t('dev.map.error')}</p>}
        <Choice
          label={t('dev.map.radius')}
          options={RADIUS_OPTIONS}
          value={settings.radius as (typeof RADIUS_OPTIONS)[number]}
          format={String}
          onPick={(radius) => update({ radius })}
        />
        <Choice
          label={t('dev.map.territories')}
          options={[false, true]}
          value={settings.territories}
          format={(v) => t(v ? 'dev.map.on' : 'dev.map.off')}
          onPick={(territories) => update({ territories })}
        />
        <ul className={styles.legend} data-testid="legend">
          {LEGEND.map((l) => (
            <li key={l.label}>
              <span className={styles.swatch} style={{ background: l.color }} />
              {t(l.label)}
            </li>
          ))}
        </ul>
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
