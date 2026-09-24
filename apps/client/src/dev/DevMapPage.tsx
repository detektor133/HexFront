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
import { TERRAIN_CANDIDATES, type TerrainPalette } from '../theme/terrain-candidates.ts';
import { tokens } from '../theme/tokens.ts';

/** Радиусы для выбора на глаз (DECISIONS 2026-09-24). */
const RADIUS_OPTIONS = [16, 20, 28, 36] as const;
/** Прозрачность территорий для выбора: текущая territory.alpha и два кандидата. */
const ALPHA_OPTIONS = [85, 65, 50] as const;
/** Период обновления показаний панели: чаще — лишние перерисовки React. */
const READOUT_MS = 250;

const LEGEND: readonly { key: keyof TerrainPalette; label: MessageKey }[] = [
  { key: 'water', label: 'terrain.water' },
  { key: 'plains', label: 'terrain.plains' },
  { key: 'forest', label: 'terrain.forest' },
  { key: 'hills', label: 'terrain.hills' },
  { key: 'mountains', label: 'terrain.mountains' },
  { key: 'desert', label: 'terrain.desert' },
];

interface Settings {
  readonly radius: number;
  readonly palette: TerrainPalette['id'];
  readonly territories: boolean;
  readonly alpha: number;
}

function readSettings(params: URLSearchParams): Settings {
  const palette = params.get('palette');
  const alpha = Number(params.get('alpha'));
  return {
    radius: Number(params.get('radius')) || tokens.map.hexRadius,
    palette: palette === 'B' || palette === 'C' ? palette : 'A',
    territories: params.get('territories') === '1',
    alpha: (ALPHA_OPTIONS as readonly number[]).includes(alpha) ? alpha : ALPHA_OPTIONS[0],
  };
}

function paletteOf(id: TerrainPalette['id']): TerrainPalette {
  return TERRAIN_CANDIDATES.find((p) => p.id === id) ?? (TERRAIN_CANDIDATES[0] as TerrainPalette);
}

function toOptions(s: Settings): MapViewOptions {
  return {
    radius: s.radius,
    palette: paletteOf(s.palette),
    midLayer: s.territories
      ? (map, radius) => {
          const layer = createFakeTerritories(map, radius);
          return {
            container: layer.container,
            update: (scale, level) => layer.update(scale, level, s.alpha / 100),
            destroy: () => layer.destroy(),
          };
        }
      : null,
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

/** /dev/map?map=small[&radius&scale&palette=A|B|C&territories=1&alpha=85|65|50&panel=0]. */
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
  const palette = paletteOf(settings.palette);

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
          label={t('dev.map.palette')}
          options={TERRAIN_CANDIDATES.map((p) => p.id)}
          value={settings.palette}
          format={String}
          onPick={(id) => update({ palette: id })}
        />
        <Choice
          label={t('dev.map.territories')}
          options={[false, true]}
          value={settings.territories}
          format={(v) => t(v ? 'dev.map.on' : 'dev.map.off')}
          onPick={(territories) => update({ territories })}
        />
        <Choice
          label={t('dev.map.alpha')}
          options={ALPHA_OPTIONS}
          value={settings.alpha as (typeof ALPHA_OPTIONS)[number]}
          format={(v) => `${v} %`}
          onPick={(alpha) => update({ alpha })}
        />
        <ul className={styles.legend} data-testid="legend">
          {LEGEND.map((l) => (
            <li key={l.key}>
              <span className={styles.swatch} style={{ background: palette[l.key] }} />
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
