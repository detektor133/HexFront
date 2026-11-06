import { IconShield, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';

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

/** Как часто плашка пересчитывает положение вслед за камерой, мс. */
const FOLLOW_MS = 33;

interface Placed {
  readonly other: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Сигнал границы: маленькая плашка прямо на границе с соседом, с которым появилась общая граница
 * и у которого нет приказа ни одной армии. Следует за картой, пока игрок не закроет её крестиком
 * или не нажмёт «Держать ▾». Один сигнал на соседа.
 */
export function BorderSignals(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly send: (cmd: Command) => void;
  readonly camera: () => SignalCamera | null;
  readonly hexWorld: (hex: number) => { readonly x: number; readonly y: number } | null;
}): React.JSX.Element | null {
  const { view, map, send, camera, hexWorld } = props;
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const [placed, setPlaced] = useState<readonly Placed[]>([]);
  const neighbours = useMemo(() => contacts(view, map), [view, map]);
  const open = useMemo(
    () =>
      [...neighbours]
        .filter(
          ([other]) => !closed.has(other) && !view.armies.some((a) => a.dir?.target === other),
        )
        .sort((a, b) => a[0] - b[0]),
    [neighbours, closed, view.armies],
  );
  useEffect(() => {
    const place = (): void => {
      const cam = camera();
      const next: Placed[] = [];
      if (cam) {
        const scale = cam.screen.width / (cam.to.x - cam.from.x);
        for (const [other, hex] of open) {
          const world = hexWorld(hex);
          if (!world) continue;
          next.push({
            other,
            x: Math.round(cam.screen.left + (world.x - cam.from.x) * scale),
            y: Math.round(cam.screen.top + (world.y - cam.from.y) * scale),
          });
        }
      }
      setPlaced((now) =>
        now.length === next.length && now.every((p, i) => p.x === next[i]?.x && p.y === next[i]?.y)
          ? now
          : next,
      );
    };
    place();
    const timer = window.setInterval(place, FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [open, camera, hexWorld]);
  const hexOf = new Map(open);
  return (
    <>
      {placed.map(({ other, x, y }) => {
        const hex = hexOf.get(other) ?? 0;
        return (
          <div key={other} className={styles.signal} style={{ left: x, top: y }}>
            <span
              className={styles.dot}
              style={{ background: tokens.players.palette[other]?.line ?? tokens.ui.ink }}
              title={view.players[other]?.name ?? String(other + 1)}
            />
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
              onClick={() => setClosed((now) => new Set(now).add(other))}
            >
              <IconX size={14} aria-hidden="true" />
            </IconButton>
          </div>
        );
      })}
    </>
  );
}
