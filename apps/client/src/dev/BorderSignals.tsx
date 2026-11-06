import { IconShield, IconX } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Command, MapStatic, PlayerView } from '@hexfront/sim';

import styles from './BorderSignals.module.css';
import { OrderSplit } from './OrderSplit.tsx';
import { autoOrder, contacts, orderArmy } from './army-order.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Камера карты: видимая область в мировых координатах и прямоугольник холста на странице. */
export interface SignalCamera {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly screen: { readonly left: number; readonly top: number; readonly width: number };
}

/**
 * Сигнал границы: значок щита цвета соседа прямо на границе, где появилась общая граница и ни одна
 * армия не стоит на соседа. Тап раскрывает «Держать ▾» и крестик; без нажатия сигнал остаётся.
 * Положение меняется только по событиям камеры и прямо в DOM, без опроса и без перерисовки React.
 */
export function BorderSignals(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly send: (cmd: Command) => void;
  readonly camera: () => SignalCamera | null;
  readonly subscribeCamera: (listener: () => void) => () => void;
  readonly hexWorld: (hex: number) => { readonly x: number; readonly y: number } | null;
}): React.JSX.Element | null {
  const { view, map, send, camera, subscribeCamera, hexWorld } = props;
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
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
  const open = useMemo(
    () =>
      [...neighbours]
        .filter(
          ([other]) => !closed.has(other) && !view.armies.some((a) => a.dir?.target === other),
        )
        .sort((a, b) => a[0] - b[0]),
    [neighbours, closed, view.armies],
  );
  const nodes = useRef(new Map<number, HTMLElement>());
  const place = useMemo(
    () => (): void => {
      const cam = camera();
      if (!cam) return;
      const scale = cam.screen.width / (cam.to.x - cam.from.x);
      for (const [other, hex] of open) {
        const node = nodes.current.get(other);
        const world = hexWorld(hex);
        if (!node || !world) continue;
        const x = cam.screen.left + (world.x - cam.from.x) * scale;
        const y = cam.screen.top + (world.y - cam.from.y) * scale;
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    },
    [open, camera, hexWorld],
  );
  useLayoutEffect(() => {
    place();
    return subscribeCamera(place);
  }, [place, subscribeCamera]);
  useEffect(() => {
    if (expanded === null) return;
    const onDown = (event: PointerEvent): void => {
      const node = nodes.current.get(expanded);
      if (node && !node.contains(event.target as Node)) setExpanded(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [expanded]);
  if (open.length === 0) return null;
  return (
    <>
      {open.map(([other, hex]) => {
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
            <div className={styles.signal}>
              <button
                type="button"
                className={styles.badge}
                style={{ borderColor: color, color }}
                title={name}
                aria-label={name}
                aria-expanded={expanded === other}
                onClick={() => setExpanded((now) => (now === other ? null : other))}
              >
                <IconShield size={18} aria-hidden="true" />
              </button>
              {expanded === other && (
                <div className={styles.actions}>
                  <OrderSplit
                    compact
                    icon={<IconShield size={16} aria-hidden="true" />}
                    label="menu.holdShort"
                    tutorial="signal-hold"
                    disabled={null}
                    armies={view.armies}
                    onAuto={() => send(autoOrder(view, map, other, 'hold', hex))}
                    onPick={(army) => send(orderArmy(view, army, other, 'hold'))}
                  />
                  <IconButton
                    label={t('menu.close')}
                    className={styles.close}
                    onClick={() => {
                      setClosed((now) => new Set(now).add(other));
                      setExpanded(null);
                    }}
                  >
                    <IconX size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
