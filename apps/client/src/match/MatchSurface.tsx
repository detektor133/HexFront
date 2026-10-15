import { useEffect, useMemo, useRef, useState } from 'react';

import { useMapJson, useSandbox } from './MatchSurfaceRuntime.tsx';
import { OnboardingHints } from './OnboardingHints.tsx';
import { PauseMenu } from './PauseMenu.tsx';
import { computeMatchLayout, matchLayoutElementStyle } from './layout.ts';
import { createPauseController } from './pause-controller.ts';
import { ArmyBar } from '../dev/ArmyBar.tsx';
import styles from '../dev/DevSandboxPage.module.css';
import { EventFeed } from '../dev/EventFeed.tsx';
import { HexCard } from '../dev/HexCard.tsx';
import { Hud } from '../dev/Hud.tsx';
import { Leaderboard } from '../dev/Leaderboard.tsx';
import { MatchEnd } from '../dev/MatchEnd.tsx';
import { ObserverPanel } from '../dev/ObserverPanel.tsx';
import { UnitCard } from '../dev/UnitCard.tsx';
import { readSandboxMap } from '../dev/sandbox-map.ts';
import { armySelection } from '../dev/sandbox-selection.ts';
import { useTelemetry } from '../dev/telemetry-client.ts';
import { t } from '../i18n/dict.ts';

/** Экран локального матча игрока с отдельной отладочной панелью. */
interface MatchSurfaceProps {
  readonly showOnboarding?: boolean;
  readonly debug?: boolean;
}

export const MatchSurface: React.FC<MatchSurfaceProps> = ({
  showOnboarding = false,
  debug = false,
}: MatchSurfaceProps = {}) => {
  const mapRequest = useMemo(() => readSandboxMap(window.location.search), []);
  const loaded = useMapJson(mapRequest);
  const hostRef = useRef<HTMLDivElement>(null);
  const sb = useSandbox(hostRef, loaded, mapRequest, debug);
  const [pauseState, setPauseState] = useState({ paused: false, menuOpen: false });
  const [popupOpen, setPopupOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(() => window.innerWidth > 600);
  const pauseController = useMemo(
    () =>
      createPauseController({
        worker: {
          postMessage: (message) => sb.setPaused(message.type === 'pause'),
        },
        seed: mapRequest.seed,
        navigate: (path) => {
          window.location.assign(path);
        },
        restart: (seed) => {
          const params = new URLSearchParams(window.location.search);
          params.set('seed', String(seed));
          window.location.assign(`${window.location.pathname}?${params.toString()}`);
        },
        onStateChange: (paused, menuOpen) => setPauseState({ paused, menuOpen }),
      }),
    [mapRequest.seed, sb.setPaused],
  );
  useEffect(() => {
    const onVisibilityChange = (): void => {
      pauseController.handleVisibilityChange(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [pauseController]);
  const downloadTelemetry = useTelemetry(
    {
      view: () => sb.msg?.view ?? null,
      pixi: sb.pixiTelemetry,
      worker: () => sb.workerTelemetry,
      snapshots: sb.snapshotTelemetry,
      caches: sb.cacheTelemetry,
    },
    { enabled: debug },
  );
  // Карточки гекса и отряда — над нижней панелью: её высота меряется, а не задаётся числом.
  const [dockH, setDockH] = useState(0);
  const [hudH, setHudH] = useState(0);
  const [cardH, setCardH] = useState(0);
  const { army } = sb;
  const view = sb.msg?.view;
  // При выборе всей армии UnitCard не рендерится, поэтому она не должна занимать место в раскладке.
  const armyUnits = view?.units.filter((u) => u.armyId !== null && u.armyId === army) ?? [];
  const armyPicked =
    armyUnits.length > 0 &&
    armyUnits.length === sb.picked.units.length &&
    armyUnits.every((u) => sb.picked.units.includes(u.id));
  const layout = computeMatchLayout({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hudHeight: hudH,
    bottomPanelHeight: dockH,
    eventRows: Math.min(3, sb.events.length),
    tutorialVisible: showOnboarding && view !== null,
    leaderboardOpen,
    leaderboardRows: view?.players.length ?? 0,
    cardHeight: cardH,
    cardOpen: !armyPicked && (sb.picked.units.length > 0 || sb.picked.hex !== null),
    popupOpen,
    paused: pauseState.menuOpen,
  });
  const map = typeof loaded === 'string' ? null : loaded.map;
  const styleFor = (id: string): React.CSSProperties | undefined => {
    const element = layout.elements.find((item) => item.id === id);
    return element ? matchLayoutElementStyle(element) : undefined;
  };
  // Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке.
  const partial = view ? armySelection(view, sb.picked.units).partial : [];
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      {styleFor('left-column') && (
        <div className={styles.leftColumn} style={styleFor('left-column')}>
          <EventFeed items={sb.events} now={performance.now()} onFocus={sb.focusEvent} />
          {showOnboarding && view && <OnboardingHints view={view} />}
        </div>
      )}
      {view && (
        <Hud
          view={view}
          send={sb.send}
          fog={sb.fog}
          setFog={sb.setFog}
          showFog={debug}
          onHeight={setHudH}
          onPopupChange={setPopupOpen}
          style={styleFor('hud')}
          popupStyle={styleFor('popup-menu')}
          {...(debug ? {} : { onPause: pauseController.pause })}
        />
      )}
      {debug && view && (
        <ObserverPanel
          view={view}
          paused={sb.paused}
          speed={sb.speed}
          observerId={sb.observerId}
          setPaused={sb.setPaused}
          step={sb.step}
          setSpeed={sb.setSpeed}
          setObserver={sb.setObserver}
          downloadTelemetry={downloadTelemetry}
        />
      )}
      {view && styleFor('leaderboard') && (
        <Leaderboard
          view={view}
          open={leaderboardOpen}
          onOpenChange={setLeaderboardOpen}
          style={styleFor('leaderboard')}
        />
      )}
      {view && <MatchEnd view={view} replay={sb.replay} onMenu={pauseController.goToMenu} />}
      {!debug && pauseState.menuOpen && (
        <PauseMenu
          onResume={pauseController.resume}
          onRestart={pauseController.restart}
          onMenu={pauseController.goToMenu}
          style={styleFor('pause-menu')}
        />
      )}
      {view && styleFor('bottom-panel') && (
        <ArmyBar
          view={view}
          selected={view.armies.some((a) => a.id === army) ? army : null}
          partial={partial.filter((a) => a !== army)}
          onHeight={(height) => {
            setDockH(height);
            sb.setDockHeight(height);
          }}
          onSelect={sb.setArmy}
          send={sb.send}
          onPick={sb.pick}
          tool={sb.tool}
          onTool={sb.setTool}
          style={styleFor('bottom-panel')}
        />
      )}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {view && map && styleFor('card') && sb.picked.units.length > 0 && !sb.tool && !armyPicked && (
        <UnitCard
          view={view}
          map={map}
          picked={sb.picked}
          send={sb.send}
          onPick={sb.pick}
          onHeight={setCardH}
          style={styleFor('card')}
        />
      )}
      {view &&
        map &&
        styleFor('card') &&
        sb.picked.units.length === 0 &&
        !sb.tool &&
        sb.msg?.selection && (
          <HexCard
            s={sb.msg.selection}
            view={view}
            map={map}
            send={sb.send}
            onRoadPreview={sb.setRoadPreview}
            onHeight={setCardH}
            style={styleFor('card')}
          />
        )}
      {debug && sb.lastReject && (
        <p className={styles.reject}>
          {t('dev.economy.lastRejection')}: {sb.lastReject}
        </p>
      )}
    </div>
  );
};
