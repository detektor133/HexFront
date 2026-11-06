import { IconFlag, IconShield, IconSwords, IconX } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ArmyView, Command, MapStatic, PlayerView } from '@hexfront/sim';

import { DiplomacyBlock } from './DiplomacyBlock.tsx';
import { OrderSplit } from './OrderSplit.tsx';
import styles from './TerritoryMenu.module.css';
import { autoOrder, isFree, nearestFreeArmy, orderArmy } from './army-order.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

const MENU_WIDTH = 264;
const EDGE = 8;

/**
 * Компактное меню земли по ЛКМ (удержанию пальцем) без выбранных отрядов и без выбранной армии.
 * Чужая страна: дипломатия, «Держать ▾» (автоподбор армии, стрелка — выбор) и «Наступать» (серая,
 * пока нет войны). Ничья земля: «Занять ▾» — ближайшая свободная армия, стрелка — любая.
 * Размер и состав армии здесь не меняются: только на панели армии.
 */
export function TerritoryMenu(props: {
  readonly view: PlayerView;
  readonly map: MapStatic;
  /** Игрок, чья это земля, или -1 — ничья земля. */
  readonly other: number;
  /** Гекс нажатия: ближайшая армия считается от него, а для ничьей земли он — приоритет волны. */
  readonly hex: number;
  /** Точка нажатия в координатах страницы. */
  readonly at: { readonly x: number; readonly y: number };
  readonly send: (cmd: Command) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { view, map, other, hex, at, send, onClose } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(120);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  const neutral = other < 0;
  const player = neutral ? null : view.players[other];
  if (!neutral && (!player || player.status !== 'alive')) return null;
  const atWar = !neutral && (view.diplomacy?.relations[other] ?? 'war') === 'war';
  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - MENU_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE));
  const name = neutral ? t('menu.neutral') : (player?.name ?? '');
  const go = (command: Command): void => {
    send(command);
    onClose();
  };
  const orderBy =
    (mode: 'hold' | 'attack') =>
    (army: ArmyView): void =>
      go(orderArmy(view, army, other, mode, neutral ? hex : undefined));
  const free = nearestFreeArmy(view, map, hex);
  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top, width: MENU_WIDTH }}
      role="dialog"
      aria-label={name}
    >
      <div className={styles.header}>
        <span
          className={styles.dot}
          style={{
            background: neutral
              ? tokens.neutral.line
              : (tokens.players.palette[other]?.line ?? tokens.ui.ink),
          }}
        />
        <span className={styles.name}>{name}</span>
        <IconButton label={t('menu.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {!neutral && <DiplomacyBlock view={view} other={other} send={send} />}
      <div className={styles.actions}>
        {neutral ? (
          <OrderSplit
            icon={<IconFlag size={20} aria-hidden="true" />}
            label="menu.occupy"
            tutorial="occupy"
            disabled={free ? null : t('order.noFree')}
            armies={view.armies}
            onAuto={() => free && go(orderArmy(view, free, -1, 'attack', hex))}
            onPick={orderBy('attack')}
          />
        ) : (
          <>
            <OrderSplit
              icon={<IconShield size={20} aria-hidden="true" />}
              label="menu.holdShort"
              tutorial="hold"
              disabled={null}
              armies={view.armies}
              onAuto={() => go(autoOrder(view, map, other, 'hold', hex))}
              onPick={orderBy('hold')}
            />
            <button
              type="button"
              className={styles.attackButton}
              data-tutorial="attack"
              disabled={!atWar}
              title={atWar ? t('menu.attack') : t('army.attackNeedWar')}
              onClick={() => go(autoOrder(view, map, other, 'attack', hex))}
            >
              <IconSwords size={20} aria-hidden="true" />
              <span>{t('menu.attack')}</span>
            </button>
          </>
        )}
      </div>
      {neutral && view.armies.length > 0 && view.armies.every((a) => !isFree(a)) && (
        <p className={styles.hint}>{t('order.noFree')}</p>
      )}
    </div>
  );
}
