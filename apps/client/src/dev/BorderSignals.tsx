import { IconShield, IconSwords, IconX } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Command, MapStatic, PlayerView } from '@hexfront/sim';

import styles from './BorderSignals.module.css';
import { OrderSplit } from './OrderSplit.tsx';
import { autoArmy, autoOrder, contacts, orderArmy } from './army-order.ts';
import type { EventFeedItem } from './event-feed.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Камера карты: видимая область в мировых координатах и прямоугольник холста на странице. */
export interface SignalCamera {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly screen: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Сколько висит сигнал объявленной нам войны, мс. */
export const WAR_SIGNAL_MS = 20_000;

/** Наименьший масштаб плашки при сильном отдалении карты. */
const MIN_SCALE = 0.4;

/** Сигнал вне экрана: сосед и гекс границы, к которому ведёт строка ленты. */
export interface OffscreenSignal {
  readonly other: number;
  readonly hex: number;
}

/**
 * Сигнал границы: плашка с «Держать ▾» и крестиком прямо над границей, где появилась общая
 * граница и ни одна армия не стоит на соседа. Появляется с выпрыгиванием и кольцом, остаётся, пока
 * не закроют или не нажмут «Держать». Если границу не видно на экране, плашка прячется, а в ленте
 * событий появляется строка со ссылкой к ней. Положение меняется только по событиям камеры и
 * прямо в DOM, без опроса и без перерисовки React.
 */
export function BorderSignals(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly send: (cmd: Command) => void;
  readonly camera: () => SignalCamera | null;
  readonly subscribeCamera: (listener: () => void) => () => void;
  readonly hexWorld: (hex: number) => { readonly x: number; readonly y: number } | null;
  /** Сигналы, которых сейчас не видно на экране (для ленты событий). */
  readonly onOffscreen: (signals: readonly OffscreenSignal[]) => void;
  /** События матча: по объявленной нам войне появляется свой сигнал. */
  readonly events?: readonly EventFeedItem[];
}): React.JSX.Element | null {
  const { view, map, send, camera, subscribeCamera, hexWorld, onOffscreen, events = [] } = props;
  // Объявленные нам войны: сосед → id события; сигнал гаснет сам через WAR_SIGNAL_MS.
  const [wars, setWars] = useState<ReadonlyMap<number, string>>(new Map());
  const seenWars = useRef(new Set<string>());
  const warTimers = useRef(new Set<number>());
  useEffect(() => {
    for (const item of events) {
      const e = item.event;
      if (e.t !== 'warDeclared' || e.targetId !== view.playerId) continue;
      if (seenWars.current.has(item.id)) continue;
      seenWars.current.add(item.id);
      const other = e.playerId;
      setWars((now) => new Map(now).set(other, item.id));
      const timer = window.setTimeout(() => {
        warTimers.current.delete(timer);
        setWars((now) => {
          if (now.get(other) !== item.id) return now;
          const next = new Map(now);
          next.delete(other);
          return next;
        });
      }, WAR_SIGNAL_MS);
      warTimers.current.add(timer);
    }
  }, [events, view.playerId]);
  useEffect(
    () => () => {
      for (const timer of warTimers.current) window.clearTimeout(timer);
    },
    [],
  );
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  // Якорь сигнала не прыгает: гекс границы запоминается, пока он остаётся своим.
  const anchors = useRef(new Map<number, number>());
  const neighbours = useMemo(() => {
    const found = contacts(view, map);
    for (const [other, hex] of found) {
      const kept = anchors.current.get(other);
      if (kept !== undefined && view.hexes.owner[kept] === view.playerId) found.set(other, kept);
      else anchors.current.set(other, hex);
    }
    return found;
  }, [view, map]);
  const open = useMemo(() => {
    const held = (other: number): boolean =>
      view.armies.some((a) => a.dir?.target === other && a.dir.mode !== 'idle');
    const list: { other: number; hex: number; war: string | null; held: boolean }[] = [];
    for (const [other, hex] of neighbours) {
      const war = wars.get(other) ?? null;
      if (war !== null) list.push({ other, hex, war, held: held(other) });
      else if (!closed.has(other) && !held(other))
        list.push({ other, hex, war: null, held: false });
    }
    // Война с тем, с кем границы нет: сигнал встаёт у его столицы.
    for (const [other, war] of wars) {
      if (neighbours.has(other)) continue;
      const capital = view.cities.find((c) => c.owner === other && c.isCapital);
      if (capital) list.push({ other, hex: capital.hex, war, held: held(other) });
    }
    return list.sort((a, b) => a.other - b.other);
  }, [neighbours, closed, wars, view.armies, view.cities]);
  const nodes = useRef(new Map<number, HTMLElement>());
  const reported = useRef('');
  const place = useMemo(
    () => (): void => {
      const cam = camera();
      if (!cam) return;
      const scale = cam.screen.width / (cam.to.x - cam.from.x);
      const away: OffscreenSignal[] = [];
      for (const { other, hex } of open) {
        const node = nodes.current.get(other);
        const world = hexWorld(hex);
        if (!world) continue;
        const x = cam.screen.left + (world.x - cam.from.x) * scale;
        const y = cam.screen.top + (world.y - cam.from.y) * scale;
        const visible =
          x >= cam.screen.left &&
          x <= cam.screen.left + cam.screen.width &&
          y >= cam.screen.top &&
          y <= cam.screen.top + cam.screen.height;
        if (!visible) away.push({ other, hex });
        if (!node) continue;
        // Плашка уменьшается вместе с картой, чтобы при отдалении не закрывать её.
        const k = Math.max(MIN_SCALE, Math.min(1, scale));
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${k.toFixed(3)})`;
        node.style.visibility = visible ? 'visible' : 'hidden';
      }
      const key = away.map((a) => `${a.other}:${a.hex}`).join(',');
      if (key !== reported.current) {
        reported.current = key;
        onOffscreen(away);
      }
    },
    [open, camera, hexWorld, onOffscreen],
  );
  useLayoutEffect(() => {
    place();
    return subscribeCamera(place);
  }, [place, subscribeCamera]);
  // Закрытые и обработанные сигналы пропадают и из ленты.
  useLayoutEffect(() => {
    if (open.length === 0 && reported.current !== '') {
      reported.current = '';
      onOffscreen([]);
    }
  }, [open.length, onOffscreen]);
  if (open.length === 0) return null;
  return (
    <>
      {open.map(({ other, hex, war, held }) => {
        const color = tokens.players.palette[other]?.line ?? tokens.ui.ink;
        const name = view.players[other]?.name ?? String(other + 1);
        return (
          <div
            key={other}
            className={styles.anchor}
            ref={(node) => {
              if (node) nodes.current.set(other, node);
              else nodes.current.delete(other);
            }}
          >
            <div
              key={war ?? 'border'}
              className={styles.signal}
              style={{ color }}
              role="group"
              aria-label={name}
            >
              <span className={styles.ripple} aria-hidden="true" />
              <span className={styles.dot} title={name} />
              {war !== null && (
                <span className={styles.war} title={t('signal.war')}>
                  <IconSwords size={18} aria-hidden="true" />
                  {held && <span>{t('signal.war')}</span>}
                </span>
              )}
              {!held && (
                <OrderSplit
                  tone="ghost"
                  icon={<IconShield size={18} aria-hidden="true" />}
                  label="menu.holdShort"
                  tutorial="signal-hold"
                  auto={autoArmy(view, map, other, hex)}
                  disabled={null}
                  armies={view.armies}
                  onAuto={() => send(autoOrder(view, map, other, 'hold', hex))}
                  onPick={(army) => send(orderArmy(view, army, other, 'hold'))}
                />
              )}
              {war === null && (
                <IconButton
                  label={t('menu.close')}
                  className={styles.close}
                  onClick={() => setClosed((now) => new Set(now).add(other))}
                >
                  <IconX size={16} aria-hidden="true" />
                </IconButton>
              )}
              {war !== null && <span className={styles.timer} aria-hidden="true" />}
            </div>
          </div>
        );
      })}
    </>
  );
}
