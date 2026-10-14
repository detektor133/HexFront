import { useMemo, useRef, useState } from 'react';

import { useMapJson, useSandbox } from './MatchSurfaceRuntime.tsx';
import { OnboardingHints } from './OnboardingHints.tsx';
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
  const [observerH, setObserverH] = useState(0);
  const { army } = sb;
  const view = sb.msg?.view;
  // Выбрана армия целиком — её сводка в нижней панели, карточка отряда не нужна (как в HoI4).
  const armyUnits = view?.units.filter((u) => u.armyId !== null && u.armyId === army) ?? [];
  const armyPicked =
    armyUnits.length > 0 &&
    armyUnits.length === sb.picked.units.length &&
    armyUnits.every((u) => sb.picked.units.includes(u.id));
  const map = typeof loaded === 'string' ? null : loaded.map;
  // Армии, часть отрядов которых выбрана на карте, — тонкая рамка на карточке.
  const partial = view ? armySelection(view, sb.picked.units).partial : [];
  return (
    <div className={styles.page} style={{ '--dock-h': `${dockH}px` } as React.CSSProperties}>
      <div ref={hostRef} className={styles.map} />
      <EventFeed
        items={sb.events}
        now={performance.now()}
        onFocus={sb.focusEvent}
        style={{ '--observer-h': `${observerH}px` } as React.CSSProperties}
      />
      {view && <Hud view={view} send={sb.send} fog={sb.fog} setFog={sb.setFog} showFog={debug} />}
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
          onHeight={setObserverH}
        />
      )}
      {debug && !view && <span hidden>Скачать телеметрию</span>}
      {view && <Leaderboard view={view} />}
      {view && <MatchEnd view={view} replay={sb.replay} />}
      {showOnboarding && view && <OnboardingHints view={view} />}
      {view && (
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
        />
      )}
      {(loaded === 'error' || sb.error) && (
        <p className={styles.error}>{sb.error ?? t('dev.map.error')}</p>
      )}
      {view && map && sb.picked.units.length > 0 && !sb.tool && !armyPicked && (
        <UnitCard view={view} map={map} picked={sb.picked} send={sb.send} onPick={sb.pick} />
      )}
      {view && map && sb.picked.units.length === 0 && !sb.tool && sb.msg?.selection && (
        <HexCard
          s={sb.msg.selection}
          view={view}
          map={map}
          send={sb.send}
          onRoadPreview={sb.setRoadPreview}
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
