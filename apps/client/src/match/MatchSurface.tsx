import { IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appSearch, navigate } from '../nav.ts';
import { BuildFeedbackMark } from './BuildFeedbackMark.tsx';
import { BuildingsPanel } from './BuildingsPanel.tsx';
import { MapTools } from './MapTools.tsx';
import { useMapJson, useSandbox } from './MatchSurfaceRuntime.tsx';
import { PauseMenu } from './PauseMenu.tsx';
import { PlacementBar } from './PlacementBar.tsx';
import { SpectatorBar, watchOrder } from './SpectatorBar.tsx';
import { computeMatchLayout, matchLayoutElementStyle } from './layout.ts';
import { createPauseController } from './pause-controller.ts';
import { ArmyBar } from '../dev/ArmyBar.tsx';
import { BorderSignals } from '../dev/BorderSignals.tsx';
import { Celebration } from '../dev/Celebration.tsx';
import styles from '../dev/DevSandboxPage.module.css';
import { EventFeed, feedRows } from '../dev/EventFeed.tsx';
import { HexCard } from '../dev/HexCard.tsx';
import { Hud } from '../dev/Hud.tsx';
import { Leaderboard } from '../dev/Leaderboard.tsx';
import { MatchEnd } from '../dev/MatchEnd.tsx';
import { ObserverPanel } from '../dev/ObserverPanel.tsx';
import { PoliticalLegend } from '../dev/PoliticalLegend.tsx';
import { TerritoryMenu } from '../dev/TerritoryMenu.tsx';
import { UnitCard } from '../dev/UnitCard.tsx';
import { readSandboxMap } from '../dev/sandbox-map.ts';
import { NOTHING_PICKED, armySelection } from '../dev/sandbox-selection.ts';
import { useTelemetry } from '../dev/telemetry-client.ts';
import { useLingering } from '../dev/use-lingering.ts';
import { t } from '../i18n/dict.ts';
import { chatStore } from '../net/chat-store.ts';
import { PREF_SHOW_PING, useBoolPref } from '../settings/bool-pref.ts';
import { enterFullscreenOnFirstTap } from '../settings/fullscreen.ts';
import { tokens } from '../theme/tokens.ts';
import { TutorialOverlay } from '../tutorial/TutorialOverlay.tsx';
import type { ChapterId, TutorialCtx } from '../tutorial/script.ts';
import { useTvPresence } from '../ui/use-tv-presence.ts';
import { useViewport } from '../ui/viewport.ts';

/** Экран локального матча игрока с отдельной отладочной панелью. */
interface MatchSurfaceProps {
  /** Глава обучения: матч-урок с подсказками поверх интерфейса. */
  readonly tutorial?: ChapterId | null;
  readonly debug?: boolean;
}

/** Высота тулбара приказов армии с отступом, px: карточки гекса и отряда встают выше него. */
const ARMY_TOOLS_H = 64;

/** Окно отрядов растёт по содержимому от нижнего края: из раскладки берутся только левый край и ширина. */
function unitCardStyle(
  layout: React.CSSProperties | undefined,
  lift: number,
  topInset: number,
): React.CSSProperties | undefined {
  if (!layout) return layout;
  return {
    left: layout.left,
    '--dock-h': `${lift}px`,
    '--top-inset': `${topInset}px`,
  } as React.CSSProperties;
}

const noSend = (): void => undefined;

/** Время затухания окна отрядов, мс (как в UnitCard.module.css). */
const CARD_FADE_MS = 160;

export const MatchSurface: React.FC<MatchSurfaceProps> = ({
  tutorial = null,
  debug = false,
}: MatchSurfaceProps = {}) => {
  const mapRequest = useMemo(() => readSandboxMap(appSearch()), []);
  const loaded = useMapJson(mapRequest);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewport = useViewport();
  const phoneView = viewport.width <= 600 || viewport.height <= 500;
  useEffect(() => enterFullscreenOnFirstTap(), []);
  const [offscreen, setOffscreen] = useState<readonly { other: number; hex: number }[]>([]);
  const sb = useSandbox(hostRef, loaded, mapRequest, debug);
  const [showPing] = useBoolPref(PREF_SHOW_PING, false);
  const chat = { sender: chatStore.getState().sender };
  const [pauseState, setPauseState] = useState({ paused: false, menuOpen: false });
  const lastPauseStyle = useRef<React.CSSProperties | undefined>(undefined);
  const pausePresence = useTvPresence(!debug && pauseState.menuOpen);
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
        navigate,
        restart: (seed) => {
          const params = new URLSearchParams(appSearch());
          params.set('seed', String(seed));
          // Тот же сид даёт ту же строку запроса, и экран не пересобрался бы: метка запуска меняет ключ.
          params.set('run', String(Date.now()));
          navigate(`/match?${params.toString()}`);
        },
        onStateChange: (paused, menuOpen) => setPauseState({ paused, menuOpen }),
      }),
    [mapRequest.seed, sb.setPaused],
  );
  // Режим строительства и выбор армии несовместимы: включённая стройка снимает выбор.
  const buildTool = sb.mapModes.build;
  useEffect(() => {
    if (buildTool === null) return;
    sb.pick(NOTHING_PICKED);
    sb.setArmy(null);
  }, [buildTool]);
  // Телефон: любое нажатие вне таблицы лидеров сворачивает её в метку.
  useEffect(() => {
    if (!leaderboardOpen || !phoneView) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      // Сама таблица и место в верхней панели (оно её открывает и закрывает) не сворачивают таблицу.
      if (target?.closest('[data-leaderboard], [data-leaderboard-toggle]')) return;
      setLeaderboardOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [leaderboardOpen, phoneView]);
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
  const [toolsH, setToolsH] = useState(0);
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
  // Выбывший онлайн-игрок смотрит чужими глазами: интерфейс тот же, но приказов нет.
  const online = new URLSearchParams(appSearch()).get('online') === '1';
  const spectator = new URLSearchParams(appSearch()).get('spectate') === '1';
  const spectating = online && (spectator || sb.observerId !== null);
  const send = spectating ? noSend : sb.send;
  const groupedCardFixture = new URLSearchParams(appSearch()).get('unitCard') === 'groups';
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
    cardView && cardPicked.units.length > 0 && !sb.tool && !spectating
      ? { view: cardView, picked: cardPicked }
      : null,
    CARD_FADE_MS,
  );
  // Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке.
  const partial = view ? armySelection(view, sb.picked.units).partial : [];
  // Тулбар приказов стоит над нижней панелью вне её высоты; карточкам над ней нужен запас под него.
  // На телефоне панель приказов уступает место окну «Постройки» и режиму строительства.
  // Чужие игроки без городов: у них идёт отсчёт до капитуляции — об этом сообщает лента.
  const capitulating = (view?.players ?? []).flatMap((p) =>
    p.id !== view?.playerId &&
    p.status === 'alive' &&
    p.graceLeftS !== undefined &&
    (view?.diplomacy ? view.diplomacy.relations[p.id] === 'war' : true)
      ? [{ player: p.id, seconds: p.graceLeftS }]
      : [],
  );
  const hideTools = phoneView && (buildingsOpen || sb.mapModes.build !== null);
  const toolsShown =
    !hideTools &&
    ((view?.armies.some((a) => a.id === army) ?? false) ||
      partial.filter((a) => a !== army).length === 1);
  const layout = computeMatchLayout({
    viewport,
    hudHeight: hudH,
    bottomPanelHeight: dockH,
    cardReserve: toolsShown ? Math.max(toolsH, ARMY_TOOLS_H) : 0,
    eventRows: feedRows(
      sb.events,
      view?.diplomacy?.incoming ?? [],
      view?.me.graceLeftS,
      offscreen.length,
      Boolean(view?.victoryHold),
      capitulating.length,
      (view?.diplomacy?.aidCalls.length ?? 0) + (view?.diplomacy?.votes.length ?? 0),
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
  const tutorialChipWorld = useCallback((hex: number) => sbRef.current.chipWorld(hex), []);
  const styleFor = (id: string): React.CSSProperties | undefined => {
    const element = layout.elements.find((item) => item.id === id);
    if (!element) return undefined;
    const style = matchLayoutElementStyle(element);
    // Телефон в ландшафте: верхняя полоса по содержимому, прижата к левому краю.
    if (id === 'hud' && viewport.width > viewport.height && viewport.height <= 500) {
      delete style.width;
      style.left = 0;
      style.maxWidth = '100%';
    }
    // Телефон в портрете: полоса во всю ширину экрана, без полей из раскладки (иначе сбоку остаются щели).
    if (id === 'hud' && viewport.width <= 600 && viewport.width <= viewport.height) {
      delete style.width;
      style.left = 0;
      style.right = 0;
    }
    if (id === 'popup-menu') {
      delete style.width;
      delete style.height;
    }
    // Нижняя панель прижата к низу экрана и растёт по содержимому: высота из раскладки её не режет.
    if (id === 'bottom-panel') {
      delete style.top;
      delete style.height;
      style.bottom = 0;
    }
    // Пауза-меню растёт по содержимому: в нём может открыться панель настроек.
    if (id === 'pause-menu') delete style.height;
    if (id === 'leaderboard') {
      delete style.width;
      delete style.height;
      if (leaderboardSize === undefined) {
        delete style.left;
        style.right = `${viewport.width <= 600 || viewport.height <= 500 ? 8 : 16}px`;
      }
    }
    if (id === 'card' && viewport.width > 600 && viewport.height > 500) {
      delete style.width;
    }
    return style;
  };
  // Окно паузы закрывается анимацией уже после того, как раскладка его убрала: держим последнее место.
  const pauseNow = styleFor('pause-menu');
  if (pauseNow !== undefined) lastPauseStyle.current = pauseNow;
  const pauseLayoutStyle = pauseNow ?? lastPauseStyle.current;
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      <PlacementBar />
      {!pauseState.menuOpen && (
        <EventFeed
          items={sb.events}
          offers={view?.diplomacy?.incoming ?? []}
          signals={offscreen}
          onSignal={sb.centerOnHex}
          hold={view?.victoryHold}
          capitulating={capitulating}
          aidCalls={view?.diplomacy?.aidCalls ?? []}
          votes={view?.diplomacy?.votes ?? []}
          nameOf={(id) => view?.players[id]?.name ?? String(id + 1)}
          send={sb.send}
          graceLeftS={view?.me.graceLeftS}
          {...(view ? { localPlayerId: view.playerId } : {})}
          now={performance.now()}
          onFocus={sb.focusEvent}
          compact={phoneView}
        />
      )}
      {view && (
        <Hud
          view={view}
          send={send}
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
          {...(phoneView ? { onPlaceClick: () => setLeaderboardOpen((open) => !open) } : {})}
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
          events={sb.events}
        />
      )}
      {view && map && sb.menu && !pauseState.menuOpen && !spectating && (
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
      {view && sb.mapModes.mapMode === 'political' && (
        <PoliticalLegend view={view} top={hudH + 12} />
      )}
      {view &&
        sb.celebration &&
        // Салют: разгром врага (с кем война) и победа коалиции; текст — в ленте и в итоговом экране.
        (sb.celebration.kind === 'won' ||
          !view.diplomacy ||
          view.diplomacy.relations[sb.celebration.player] === 'war') && (
          <Celebration cue={{ key: sb.celebration.key, text: null }} />
        )}
      {view && (
        <MatchEnd
          view={view}
          fog={sb.fog}
          spectating={spectating}
          onWatch={(message) => {
            // Онлайн «Смотреть» открывает вид лучшего живого игрока; локально снимает туман.
            const first = online ? watchOrder(view)[0] : undefined;
            if (first !== undefined) sb.setObserver(first);
            else sb.setFog(message.enabled);
          }}
          onMenu={pauseController.goToMenu}
          onRematch={chat.sender?.rematch}
          {...(() => {
            const won = sb.msg?.events.find((event) => event.t === 'matchWon');
            if (won?.t !== 'matchWon') return {};
            return { reason: won.reason, ...(won.allies ? { allies: won.allies } : {}) };
          })()}
        />
      )}
      {pausePresence.mounted && (
        <PauseMenu
          className={pausePresence.className}
          onResume={pauseController.resume}
          onRestart={
            new URLSearchParams(appSearch()).get('online') === '1'
              ? undefined
              : pauseController.restart
          }
          onMenu={pauseController.goToMenu}
          style={pauseLayoutStyle}
        />
      )}
      {view && spectating && <SpectatorBar view={view} onWatch={sb.setObserver} />}
      {view && styleFor('bottom-panel') && !spectating && (
        <ArmyBar
          view={view}
          selected={view.armies.some((a) => a.id === army) ? army : null}
          partial={partial.filter((a) => a !== army)}
          pickedUnits={sb.picked.units}
          onHeight={handleArmyBarHeight}
          onToolsHeight={setToolsH}
          hideTools={hideTools}
          onSelect={sb.setArmy}
          onFocusArmy={sb.focusArmy}
          groups={sb.groupDigits}
          send={sb.send}
          onPick={sb.pick}
          holdPicking={sb.holdPick !== null}
          onHoldPick={sb.setHoldPick}
          onInvade={sb.invasion.start}
          invading={sb.invasion.stage !== 'off'}
          style={
            phoneView && buildingsOpen
              ? { ...styleFor('bottom-panel'), display: 'none' }
              : styleFor('bottom-panel')
          }
        />
      )}
      {phoneView && sb.picked.units.length > 0 && !hideTools && !pauseState.menuOpen && (
        <button
          type="button"
          className={styles.clearSelection}
          style={{ left: 8, bottom: dockH + (toolsShown ? Math.max(toolsH, ARMY_TOOLS_H) : 0) + 8 }}
          aria-label={t('selection.clear')}
          title={t('selection.clear')}
          onClick={() => {
            sb.pick(NOTHING_PICKED);
            sb.setArmy(null);
          }}
        >
          <IconX size={18} aria-hidden="true" />
          <span>{sb.picked.units.length}</span>
        </button>
      )}
      <BuildFeedbackMark feedback={sb.mapModes.feedback} />
      {view && !debug && !pauseState.menuOpen && !spectating && (
        <MapTools
          mapMode={sb.mapModes.mapMode}
          build={sb.mapModes.build}
          setMapMode={sb.mapModes.setMapMode}
          setBuild={sb.mapModes.setBuild}
          bottom={dockH + (toolsShown ? Math.max(toolsH, ARMY_TOOLS_H) : 0) + 12}
          top={
            phoneView
              ? (viewport.width > viewport.height
                  ? hudH
                  : Math.max(
                      hudH,
                      (() => {
                        const lb = layout.elements.find((item) => item.id === 'leaderboard');
                        return lb ? lb.y + lb.height : 0;
                      })(),
                    )) + 8
              : undefined
          }
          gold={view.players.find((p) => p.id === view.playerId)?.gold ?? 0}
          cityCost={view.me.foundCityCost}
          buildingsOpen={buildingsOpen}
          drawer={phoneView && viewport.width <= viewport.height}
          onToggleBuildings={() => setBuildingsOpen((open) => !open)}
          chatPlayers={view.players.map((p) => ({ id: p.id, name: p.name ?? String(p.id + 1) }))}
        />
      )}
      {view && !debug && buildingsOpen && !spectating && (
        <BuildingsPanel
          view={view}
          send={sb.send}
          onFocus={sb.focusHex}
          onClose={() => setBuildingsOpen(false)}
          top={hudH}
          viewport={viewport}
          avoidY={(() => {
            const lb = layout.elements.find((item) => item.id === 'leaderboard');
            return lb ? lb.y + lb.height : 0;
          })()}
        />
      )}
      {sb.netStatus !== 'online' ? (
        <p className={styles.error} role="status">
          {t('net.reconnecting')}
        </p>
      ) : (
        sb.pingMs !== null &&
        (sb.pingMs > 200 || showPing) && (
          <p className={styles.error} role="status">
            {`${sb.pingMs} ${t('net.ping')}`}
          </p>
        )
      )}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {unitCard.value && map && styleFor('card') && !phoneView && (
        <UnitCard
          view={unitCard.value.view}
          map={map}
          picked={unitCard.value.picked}
          closing={unitCard.closing}
          send={sb.send}
          onPick={sb.pick}
          onHeight={setCardH}
          style={unitCardStyle(
            styleFor('card'),
            dockH + (toolsShown ? Math.max(toolsH, ARMY_TOOLS_H) : 0),
            hudH,
          )}
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
            send={send}
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
          chipWorld={tutorialChipWorld}
          onStage={sb.setTutorialStage}
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
