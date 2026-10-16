import { useEffect, useRef, useState } from 'react';

import { loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { quickMatchUrl } from '../routes.ts';
import styles from './MainMenu.module.css';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;

const NICKNAME_KEY = 'hexfront.nickname';
const COLOR_KEY = 'hexfront.color';
const AUTO_COMMAND_KEY = 'hexfront.auto-command';

function readStorage(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function matchUrl(nickname: string, color: string, autoCommand: boolean): string {
  const url = new URL(quickMatchUrl(), window.location.origin);
  if (nickname !== '') url.searchParams.set('name', nickname);
  url.searchParams.set('color', color);
  url.searchParams.set('auto', autoCommand ? '1' : '0');
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** Главное меню быстрого локального матча. */
export function MainMenu(): React.JSX.Element {
  const backgroundHostRef = useRef<HTMLDivElement>(null);
  const colorsRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<LocalMatch | null>(null);
  const [nickname, setNickname] = useState<string>(() => readStorage(NICKNAME_KEY, ''));
  const [color, setColor] = useState<string>(() => readStorage(COLOR_KEY, 'teal'));
  const [isColorPickerOpen, setIsColorPickerOpen] = useState<boolean>(false);
  const [autoCommand, setAutoCommand] = useState<boolean>(
    () => readStorage(AUTO_COMMAND_KEY, 'false') === 'true',
  );

  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let pendingMessage: Extract<FromWorker, { t: 'view' }> | null = null;
    const deltaApplier = new ViewDeltaApplier();
    const applyMessage = (message: Extract<FromWorker, { t: 'view' }>): void => {
      if (layer === null) {
        pendingMessage = message;
        return;
      }
      const view =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      layer.setView(view, EMPTY_SELECTION);
      layer.frame(performance.now());
    };
    backgroundRef.current = startLocalMatch(
      'small',
      1,
      { count: 6, bots: [0, 1, 2, 3, 4, 5], speed: 1 },
      (message: FromWorker): void => {
        if (message.t === 'view') applyMessage(message);
      },
      { fog: false, playerColors: playerColorIds(color).slice(0, 2) },
    );
    const startBackground = async (): Promise<void> => {
      const response = await fetch('/maps/small.json');
      const json: unknown = await response.json();
      const loaded = loadMap(json);
      if (disposed || !loaded.ok || backgroundHostRef.current === null) return;
      mapView = await createMapView(
        backgroundHostRef.current,
        loaded.map,
        {
          radius: tokens.map.hexRadius,
          midLayer: (map, radius) => {
            layer = createEconomyLayer(map, radius);
            return layer;
          },
        },
        () => undefined,
      );
      if (disposed) return;
      if (pendingMessage !== null) applyMessage(pendingMessage);
    };
    void startBackground();
    return () => {
      disposed = true;
      backgroundRef.current?.dispose();
      layer?.destroy();
      mapView?.destroy();
      backgroundRef.current = null;
    };
  }, [color]);

  useEffect(() => {
    const closeColorPicker = (event: MouseEvent): void => {
      if (!colorsRef.current?.contains(event.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', closeColorPicker);
    return () => document.removeEventListener('mousedown', closeColorPicker);
  }, []);

  const handleColor = (next: string): void => {
    setColor(next);
    localStorage.setItem(COLOR_KEY, next);
  };

  const handlePlay = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(AUTO_COMMAND_KEY, String(autoCommand));
  };

  return (
    <main className={styles.page}>
      <div ref={backgroundHostRef} className={styles.background} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="main-menu-title">
        <p className={styles.wordmark}>Hexfront</p>
        <h1 id="main-menu-title" className={styles.title}>
          {t('menu.title')}
        </h1>
        <p className={styles.subtitle}>{t('menu.subtitle')}</p>
        <label className={styles.field}>
          <span>{t('menu.nickname')}</span>
          <input
            value={nickname}
            maxLength={16}
            onChange={(event) => setNickname(event.target.value.slice(0, 16))}
          />
        </label>
        <div className={styles.field}>
          <span>{t('menu.color')}</span>
          <div
            ref={colorsRef}
            className={styles.colors}
            style={
              isColorPickerOpen
                ? { display: 'grid', gridTemplateColumns: '28px 28px 28px 28px 28px 28px' }
                : undefined
            }
          >
            {(isColorPickerOpen
              ? tokens.players.palette
              : tokens.players.palette.filter((playerColor) => playerColor.id === color)
            ).map((playerColor) => (
              <button
                key={playerColor.id}
                type="button"
                className={`${styles.color} ${playerColor.id === color ? styles.selected : ''}`}
                aria-label={`${t('menu.color')} ${playerColor.id}`}
                style={{ backgroundColor: playerColor.line, width: '28px', height: '28px' }}
                onClick={() => {
                  if (!isColorPickerOpen) {
                    setIsColorPickerOpen(true);
                    return;
                  }
                  handleColor(playerColor.id);
                  setIsColorPickerOpen(false);
                }}
              />
            ))}
          </div>
        </div>
        <a
          className={styles.play}
          role="button"
          href={matchUrl(nickname, color, autoCommand)}
          onClick={handlePlay}
        >
          {t('menu.play')}
        </a>
        <section className={styles.section} aria-labelledby="settings-title">
          <h2 id="settings-title">{t('menu.settings')}</h2>
          <button
            type="button"
            className={styles.secondary}
            aria-pressed={autoCommand}
            onClick={() => setAutoCommand((value) => !value)}
          >
            {t('menu.autoCommand')}
          </button>
          {'requestFullscreen' in document.documentElement && (
            <button type="button" className={styles.secondary}>
              {t('menu.fullscreen')}
            </button>
          )}
        </section>
      </section>
    </main>
  );
}
