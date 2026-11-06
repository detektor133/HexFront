import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BuildFeedbackMark } from './BuildFeedbackMark.tsx';
import { BuildingsPanel } from './BuildingsPanel.tsx';
import { MapTools } from './MapTools.tsx';
import { useMapJson, useSandbox } from './MatchSurfaceRuntime.tsx';
import { PauseMenu } from './PauseMenu.tsx';
import { computeMatchLayout, matchLayoutElementStyle } from './layout.ts';
import { createPauseController } from './pause-controller.ts';
import { ArmyBar } from '../dev/ArmyBar.tsx';
import { BorderSignals } from '../dev/BorderSignals.tsx';
import styles from '../dev/DevSandboxPage.module.css';
import { EventFeed, feedRows } from '../dev/EventFeed.tsx';
import { HexCard } from '../dev/HexCard.tsx';
import { Hud } from '../dev/Hud.tsx';
import { Leaderboard } from '../dev/Leaderboard.tsx';
import { MatchEnd } from '../dev/MatchEnd.tsx';
import { ObserverPanel } from '../dev/ObserverPanel.tsx';
import { TerritoryMenu } from '../dev/TerritoryMenu.tsx';
import { UnitCard } from '../dev/UnitCard.tsx';
import { readSandboxMap } from '../dev/sandbox-map.ts';
import { NOTHING_PICKED, armySelection } from '../dev/sandbox-selection.ts';
import { useTelemetry } from '../dev/telemetry-client.ts';
import { useLingering } from '../dev/use-lingering.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { TutorialOverlay } from '../tutorial/TutorialOverlay.tsx';
import type { ChapterId, TutorialCtx } from '../tutorial/script.ts';

/** Экран локального матча игрока с отдельной отладочной панелью. */
interface MatchSurfaceProps {
  /** Глава обучения: матч-урок с подсказками поверх интерфейса. */
  readonly tutorial?: ChapterId | null;
  readonly debug?: boolean;
}

/** Высота тулбара приказов армии с отступом, px: карточки гекса и отряда встают выше него. */
const ARMY_TOOLS_H = 64;

/** Время затухания окна отрядов, мс (как в UnitCard.module.css). */
const CARD_FADE_MS = 160;

export const MatchSurface: React.FC<MatchSurfaceProps> = ({
  tutorial = null,
  debug = false,
}: MatchSurfaceProps = {}) => {
  const mapRequest = useMemo(() => readSandboxMap(window.location.search), []);
  const loaded = useMapJson(mapRequest);
  const hostRef = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState<readonly { other: number; hex: number }[]>([]);
  const sb = useSandbox(hostRef, loaded, mapRequest, debug);
  const [pauseState, setPauseState] = useState({ paused: false, menuOpen: false });
  const [popupOpen, setPopupOpen] = useState(false);
  const [buildingsOpen, setBuildingsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(
    () => window.innerWidth > 600 && window.innerHeight > 500,
  );
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
  // ПКМ в матче — приказ и меню страны: контекстное меню браузера не нужно нигде на странице.
  useEffect(() => {
    const noMenu = (event: MouseEvent): void => event.preventDefault();
    document.addEventListener('contextmenu', noMenu);
    return () => document.removeEventListener('contextmenu', noMenu);
  }, []);
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
  const [leaderboardSize, setLeaderboardSize] = useState<
    { readonly width: number; readonly height: number } | undefined
  >(undefined);
  const [taxAnchor, setTaxAnchor] = useState<{ x: number; y: number } | undefined>(undefined);
  const [taxPopupSize, setTaxPopupSize] = useState<{ width: number; height: number } | undefined>(
    undefined,
  );
  const { army } = sb;
  const view = sb.msg?.view;
  const groupedCardFixture =
    new URLSearchParams(window.location.search).get('unitCard') === 'groups';
  const fixtureSourceUnit = view?.units.find(
    (unit) => unit.owner === view.playerId && unit.order !== 'retreat' && unit.armyId !== null,
  );
  const cardView =
    view && groupedCardFixture && fixtureSourceUnit
      ? {
          ...view,
          units: [
            { ...fixtureSourceUnit, id: 2_147_483_646 },
            { ...fixtureSourceUnit, id: 2_147_483_647 },
          ],
        }
      : view;
  const cardPicked =
    groupedCardFixture && fixtureSourceUnit
      ? { hex: null, units: [2_147_483_646, 2_147_483_647], target: null }
      : sb.picked;
  // Окно отрядов закрывается плавно: после снятия выбора его ещё показывают на время затухания.
  const unitCard = useLingering(
    cardView && cardPicked.units.length > 0 && !sb.tool
      ? { view: cardView, picked: cardPicked }
      : null,
    CARD_FADE_MS,
  );
  // Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке.
  const partial = view ? armySelection(view, sb.picked.units).partial : [];
  // Тулбар приказов стоит над нижней панелью вне её высоты; карточкам над ней нужен запас под него.
  const toolsShown =
    (view?.armies.some((a) => a.id === army) ?? false) ||
    partial.filter((a) => a !== army).length === 1;
  const layout = computeMatchLayout({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hudHeight: hudH,
    bottomPanelHeight: dockH,
    cardReserve: toolsShown ? ARMY_TOOLS_H : 0,
    eventRows: feedRows(
      sb.events,
      view?.diplomacy?.incoming ?? [],
      view?.me.graceLeftS,
      offscreen.length,
      Boolean(view?.victoryHold),
    ),
    tutorialVisible: false,
    leaderboardOpen,
    leaderboardRows: view?.ranking?.length ?? 0,
    ...(leaderboardSize === undefined ? {} : { leaderboardSize }),
    cardHeight: cardH,
    cardOpen: unitCard.value !== null || sb.picked.hex !== null,
    popupOpen,
    ...(taxAnchor === undefined ? {} : { popupAnchorX: taxAnchor.x, popupAnchorY: taxAnchor.y }),
    ...(taxPopupSize === undefined ? {} : { popupSize: taxPopupSize }),
    paused: pauseState.menuOpen,
  });
  useEffect(() => {
    if (leaderboardSize === undefined) return;
    sb.setDockHeight(dockH, leaderboardSize.width);
  }, [dockH, leaderboardSize, sb]);
  const dockHeightSetter = useRef(sb.setDockHeight);
  dockHeightSetter.current = sb.setDockHeight;
  const handleArmyBarHeight = useMemo(
    () =>
      (height: number): void => {
        setDockH(height);
        dockHeightSetter.current(height);
      },
    [],
  );
  const map = typeof loaded === 'string' ? null : loaded.map;
  // Обучение читает матч так же, как игрок видит его: снимок, выбор и открытые окна.
  const sbRef = useRef(sb);
  sbRef.current = sb;
  const tutorialCtx = useMemo<Omit<TutorialCtx, 'pans' | 'zooms'> | null>(
    () =>
      tutorial && view && map
        ? {
            view,
            map,
            picked: sb.picked,
            menuOther: sb.menu?.other ?? null,
            army: sb.army,
            build: sb.mapModes.build,
            mapMode: sb.mapModes.mapMode,
            buildingsOpen,
          }
        : null,
    [
      tutorial,
      view,
      map,
      sb.picked,
      sb.menu,
      sb.army,
      sb.mapModes.build,
      sb.mapModes.mapMode,
      buildingsOpen,
    ],
  );
  const tutorialCamera = useCallback(() => {
    const rect = sbRef.current.cameraRect();
    const host = hostRef.current;
    return rect && host ? { ...rect, screen: host.getBoundingClientRect() } : null;
  }, []);
  const subscribeCamera = useCallback(
    (listener: () => void) => sbRef.current.subscribeCamera(listener),
    [],
  );
  const tutorialHexWorld = useCallback((hex: number) => sbRef.current.hexWorld(hex), []);
  const styleFor = (id: string): React.CSSProperties | undefined => {
    const element = layout.elements.find((item) => item.id === id);
    if (!element) return undefined;
    const style = matchLayoutElementStyle(element);
    if (id === 'popup-menu') {
      delete style.width;
      delete style.height;
    }
    if (id === 'leaderboard') {
      delete style.width;
      delete style.height;
      if (leaderboardSize === undefined) {
        delete style.left;
        style.right = `${window.innerWidth <= 600 || window.innerHeight <= 500 ? 8 : 16}px`;
      }
    }
    if (id === 'card' && window.innerWidth > 600 && window.innerHeight > 500) {
      delete style.width;
    }
    return style;
  };
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      <EventFeed
        items={sb.events}
        offers={view?.diplomacy?.incoming ?? []}
        signals={offscreen}
        onSignal={sb.centerOnHex}
        hold={view?.victoryHold}
        nameOf={(id) => view?.players[id]?.name ?? String(id + 1)}
        send={sb.send}
        graceLeftS={view?.me.graceLeftS}
        {...(view ? { localPlayerId: view.playerId } : {})}
        now={performance.now()}
        onFocus={sb.focusEvent}
      />
      {view && (
        <Hud
          view={view}
          send={sb.send}
          fog={sb.fog}
          setFog={sb.setFog}
          showFog={debug}
          onHeight={(height) => {
            setHudH(height);
            sb.setHudHeight?.(height);
          }}
          onPopupChange={setPopupOpen}
          onTaxAnchor={setTaxAnchor}
          onTaxSize={setTaxPopupSize}
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
          onPick={sb.centerOnHex}
          open={leaderboardOpen}
          onOpenChange={setLeaderboardOpen}
          onSize={setLeaderboardSize}
          style={styleFor('leaderboard')}
        />
      )}
      {view && map && !debug && !tutorial && !pauseState.menuOpen && (
        <BorderSignals
          view={view}
          map={map}
          send={sb.send}
          camera={tutorialCamera}
          subscribeCamera={subscribeCamera}
          onOffscreen={setOffscreen}
          hexWorld={tutorialHexWorld}
        />
      )}
      {view && map && sb.menu && !pauseState.menuOpen && (
        <TerritoryMenu
          view={view}
          map={map}
          other={sb.menu.other}
          hex={sb.menu.hex}
          at={sb.menu}
          send={sb.send}
          onClose={sb.closeMenu}
          onSelectArmy={(armyId) => {
            sb.setArmy(armyId);
            sb.pick({
              hex: null,
              units: view.units
                .filter((u) => u.owner === view.playerId && u.armyId === armyId)
                .map((u) => u.id),
              target: null,
            });
            sb.focusArmy(armyId);
          }}
        />
      )}
      {view && (
        <MatchEnd
          view={view}
          fog={sb.fog}
          onWatch={(message) => sb.setFog(message.enabled)}
          onMenu={pauseController.goToMenu}
          {...(() => {
            const won = sb.msg?.events.find((event) => event.t === 'matchWon');
            if (won?.t !== 'matchWon') return {};
            return { reason: won.reason, ...(won.allies ? { allies: won.allies } : {}) };
          })()}
        />
      )}
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
          pickedUnits={sb.picked.units}
          onHeight={handleArmyBarHeight}
          onSelect={sb.setArmy}
          onFocusArmy={sb.focusArmy}
          groups={sb.groupDigits}
          send={sb.send}
          onPick={sb.pick}
          holdPicking={sb.holdPick !== null}
          onHoldPick={sb.setHoldPick}
          style={styleFor('bottom-panel')}
        />
      )}
      <BuildFeedbackMark feedback={sb.mapModes.feedback} />
      {view && !debug && (
        <MapTools
          mapMode={sb.mapModes.mapMode}
          build={sb.mapModes.build}
          setMapMode={sb.mapModes.setMapMode}
          setBuild={sb.mapModes.setBuild}
          bottom={dockH + 12}
          gold={view.players.find((p) => p.id === view.playerId)?.gold ?? 0}
          buildingsOpen={buildingsOpen}
          onToggleBuildings={() => setBuildingsOpen((open) => !open)}
        />
      )}
      {view && !debug && buildingsOpen && (
        <BuildingsPanel
          view={view}
          send={sb.send}
          onFocus={sb.focusHex}
          onClose={() => setBuildingsOpen(false)}
          top={hudH}
        />
      )}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {unitCard.value && map && styleFor('card') && (
        <UnitCard
          view={unitCard.value.view}
          map={map}
          picked={unitCard.value.picked}
          closing={unitCard.closing}
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
            onClose={() => sb.pick(NOTHING_PICKED)}
            onRoadPreview={sb.setRoadPreview}
            onHeight={setCardH}
            style={styleFor('card')}
          />
        )}
      {tutorial && (
        <TutorialOverlay
          chapter={tutorial}
          ctx={tutorialCtx}
          camera={tutorialCamera}
          hexWorld={tutorialHexWorld}
          hexRadius={tokens.map.hexRadius}
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
