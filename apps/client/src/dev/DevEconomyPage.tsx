import { useEffect, useRef, useState } from 'react';

import {
  hexFromId,
  hexId,
  inBounds,
  loadMap,
  TAX_MAX,
  TAX_STEP,
  type Command,
  type ConstructionCheck,
  type Fp,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import styles from './DevEconomyPage.module.css';
import { createEconomyLayer, type EconomyLayer } from './economy-layer.ts';
import { reasonText, t } from '../i18n/dict.ts';
import { HUMAN_ID } from '../local/engine.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker, Selection } from '../local/messages.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

/** Сид и число игроков отладочного матча: игрок и соперник без ботов (боты — этап 05). */
const SEED = 42;
const PLAYERS = 2;

/** Fixed-point → строка с одним знаком после запятой. */
const num = (fp: number): string => (fp / 1000).toFixed(1);
const percent = (fp: number): string => `${Math.round(fp / 10)} %`;

function useMapJson(id: string): { json: unknown; map: MapStatic } | 'loading' | 'error' {
  const [state, setState] = useState<{ json: unknown; map: MapStatic } | 'loading' | 'error'>(
    'loading',
  );
  useEffect(() => {
    let alive = true;
    fetch(`/maps/${encodeURIComponent(id)}.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: unknown) => {
        const result = loadMap(json);
        if (!result.ok) throw new Error(result.errors.join('; '));
        if (alive) setState({ json, map: result.map });
      })
      .catch((error: unknown) => {
        console.error('dev_economy_map_failed', error);
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

function Action(props: {
  label: string;
  check: ConstructionCheck | { ok: true; cost: number } | { ok: false; reason: string };
  onClick: () => void;
}): React.JSX.Element {
  const { check } = props;
  return (
    <div className={styles.action}>
      {/* Недоступная кнопка остаётся кликабельной и показывает причину (ui.md). */}
      <button type="button" className={styles.button} onClick={props.onClick}>
        {props.label}
        {check.ok && <span className={styles.price}> · {num(check.cost)}</span>}
      </button>
      {!check.ok && <span className={styles.reason}>{reasonText(check.reason)}</span>}
    </div>
  );
}

function CityCard(props: { s: Selection; send: (cmd: Command) => void }): React.JSX.Element | null {
  const c = props.s.city;
  if (!c) return null;
  const rebuild = c.rebuild;
  return (
    <section className={styles.card}>
      <h2 className={styles.subtitle}>{t('dev.economy.city')}</h2>
      <dl className={styles.stats}>
        <dt>{t('dev.economy.level')}</dt>
        <dd>{c.level}</dd>
        <dt>{t('dev.economy.supply')}</dt>
        <dd>{num(c.supply)}</dd>
        <dt>{t('dev.economy.cityGold')}</dt>
        <dd>{num(c.goldPerS)}</dd>
      </dl>
      <p className={c.link === 'isolated' ? styles.bad : styles.good}>
        {t(c.link === 'isolated' ? 'dev.economy.isolated' : 'dev.economy.connected')}
      </p>
      {c.roadJob && (
        <p>
          {t('dev.economy.roadJob')} · {c.roadJob.built} {t('dev.economy.of')} {c.roadJob.total}
        </p>
      )}
      <Action
        label={t('dev.economy.upgrade')}
        check={c.upgrade}
        onClick={() => props.send({ t: 'upgradeCity', cityId: c.id })}
      />
      {rebuild && (
        <Action
          label={t('dev.economy.rebuild')}
          check={
            rebuild.ok
              ? rebuild.affordable
                ? { ok: true, cost: rebuild.cost }
                : { ok: false, reason: 'notEnoughGold' }
              : rebuild
          }
          onClick={() => props.send({ t: 'rebuildSupply', cityId: c.id })}
        />
      )}
    </section>
  );
}

function HexCard(props: {
  s: Selection;
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element {
  const { s, view, send } = props;
  const owner = view.hexes.owner[s.hex] ?? -1;
  const ownerText =
    owner < 0
      ? t('dev.economy.neutral')
      : owner === HUMAN_ID
        ? t('dev.economy.you')
        : t('dev.economy.rival');
  return (
    <section className={styles.card}>
      <h2 className={styles.subtitle}>
        {t('dev.economy.hex')} #{s.hex}
      </h2>
      <dl className={styles.stats}>
        <dt>{t('dev.economy.owner')}</dt>
        <dd>{ownerText}</dd>
        <dt>{t('dev.economy.pop')}</dt>
        <dd>
          {num(view.hexes.pop[s.hex] ?? 0)} / {num(s.popCap)}
        </dd>
        <dt>{t('dev.economy.growth')}</dt>
        <dd>{num(view.hexes.growth[s.hex] ?? 0)}</dd>
      </dl>
      <CityCard s={s} send={send} />
      {!s.city && (
        <>
          <Action
            label={t('dev.economy.foundCity')}
            check={s.foundCity}
            onClick={() => send({ t: 'foundCity', hex: s.hex })}
          />
          <Action
            label={t('dev.economy.improve')}
            check={s.improve}
            onClick={() => send({ t: 'improve', hex: s.hex })}
          />
        </>
      )}
      <Action
        label={t('dev.economy.fort')}
        check={s.fort}
        onClick={() => send({ t: 'build', hex: s.hex, kind: 'fort' })}
      />
      <Action
        label={t('dev.economy.depot')}
        check={s.depot}
        onClick={() => send({ t: 'build', hex: s.hex, kind: 'depot' })}
      />
    </section>
  );
}

type ViewMessage = Extract<FromWorker, { t: 'view' }>;

/** Локальный матч + карта: запускает Web Worker и сцену Pixi, отдаёт последний снимок. */
function useLocalEconomy(
  hostRef: React.RefObject<HTMLDivElement | null>,
  loaded: ReturnType<typeof useMapJson>,
): {
  msg: ViewMessage | null;
  error: string | null;
  lastReason: string | null;
  send: (cmd: Command) => void;
} {
  const matchRef = useRef<LocalMatch | null>(null);
  const layerRef = useRef<EconomyLayer | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [msg, setMsg] = useState<ViewMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastReason, setLastReason] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof loaded === 'string') return;
    const { map, json } = loaded;
    let view: MapView | null = null;
    let cancelled = false;
    const match = startLocalMatch(json, SEED, PLAYERS, (m) => {
      if (m.t === 'error') return setError(m.errors.join('; '));
      layerRef.current?.setView(m.view, selectedRef.current);
      const last = m.rejected.at(-1);
      if (last) setLastReason(last.reason);
      setMsg(m);
    });
    matchRef.current = match;
    // Параметры для скриншотов и отладки: сразу выбранный гекс и масштаб.
    const params = new URLSearchParams(window.location.search);
    const initialSelect = params.get('select');
    if (initialSelect !== null) {
      selectedRef.current = Number(initialSelect);
      match.select(selectedRef.current);
    }
    const initialScale = Number(params.get('scale'));
    const onTap = (h: { q: number; r: number }): void => {
      const id = inBounds(h, map.width, map.height) ? hexId(h, map.width) : null;
      selectedRef.current = id;
      match.select(id);
    };
    const options = {
      radius: tokens.map.hexRadius,
      midLayer: (m: MapStatic, radius: number) =>
        (layerRef.current = createEconomyLayer(m, radius)),
    };
    void createMapView(host, map, options, () => {}, onTap).then((v) => {
      if (cancelled) return v.destroy();
      view = v;
      if (initialScale > 0) v.setScale(initialScale);
      if (selectedRef.current !== null) v.centerOn(hexFromId(selectedRef.current, map.width));
    });
    return () => {
      cancelled = true;
      match.dispose();
      view?.destroy();
      matchRef.current = null;
      layerRef.current = null;
    };
  }, [hostRef, loaded]);

  return { msg, error, lastReason, send: (cmd) => matchRef.current?.send(cmd) };
}

function TaxPanel(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element | null {
  const me = props.view.players[HUMAN_ID];
  if (!me) return null;
  return (
    <>
      <dl className={styles.stats}>
        <dt>{t('dev.economy.gold')}</dt>
        <dd data-testid="gold">{num(me.gold)}</dd>
        <dt>{t('dev.economy.tax')}</dt>
        <dd>
          {percent(me.taxTarget)} ({t('dev.economy.taxNow')} {percent(me.taxEffective)})
        </dd>
      </dl>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={TAX_MAX}
        step={TAX_STEP}
        value={me.taxTarget}
        aria-label={t('dev.economy.tax')}
        onChange={(e) => props.send({ t: 'setTax', rate: Number(e.target.value) as Fp })}
      />
    </>
  );
}

/** /dev/economy?map=small[&select=HexId&scale]: локальный матч в Web Worker, отладочный вид (02/T10). */
export function DevEconomyPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const loaded = useMapJson(params.get('map') ?? 'small');
  const hostRef = useRef<HTMLDivElement>(null);
  const { msg, error, lastReason, send } = useLocalEconomy(hostRef, loaded);
  return (
    <div className={styles.page}>
      <div ref={hostRef} className={styles.map} />
      <aside className={styles.panel}>
        <h1 className={styles.title}>{t('dev.economy.title')}</h1>
        {(loaded === 'error' || error) && (
          <p className={styles.bad}>{error ?? t('dev.map.error')}</p>
        )}
        {msg && <TaxPanel view={msg.view} send={send} />}
        {msg?.selection ? (
          <HexCard s={msg.selection} view={msg.view} send={send} />
        ) : (
          <p className={styles.hint}>{t('dev.economy.pickHex')}</p>
        )}
        {lastReason && (
          <p className={styles.reason}>
            {t('dev.economy.lastRejection')}: {reasonText(lastReason)}
          </p>
        )}
      </aside>
    </div>
  );
}
