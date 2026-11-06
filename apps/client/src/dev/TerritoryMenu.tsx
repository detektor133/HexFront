import {
  IconChevronsDown,
  IconChevronsUp,
  IconEqual,
  IconFlag,
  IconShield,
  IconShieldOff,
  IconSwords,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ArmyView, Command, MapStatic, PlayerView } from '@hexfront/sim';

import { DiplomacyBlock } from './DiplomacyBlock.tsx';
import { OrderSplit } from './OrderSplit.tsx';
import styles from './TerritoryMenu.module.css';
import { armyName } from './army-name.ts';
import {
  autoArmy,
  autoOrder,
  isFree,
  nearestFreeArmy,
  orderArmy,
  strengthVs,
} from './army-order.ts';
import { t } from '../i18n/dict.ts';
import { armyColor } from '../theme/colors.ts';
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
  /** Выбрать армию на карте (клик по подписи армии, которая держит эту страну). */
  readonly onSelectArmy?: (armyId: number) => void;
}): React.JSX.Element | null {
  const { view, map, other, hex, at, send, onClose, onSelectArmy } = props;
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
  // Армия, уже стоящая на эту страну: от неё зависят кнопки «Оборона» и «Снять с фронта».
  const holder = neutral ? undefined : view.armies.find((a) => a.dir?.target === other);
  const holders = neutral ? [] : view.armies.filter((a) => a.dir?.target === other);
  const strength = neutral ? null : strengthVs(view, other);
  const StrengthIcon =
    strength === 'stronger' ? IconChevronsUp : strength === 'weaker' ? IconChevronsDown : IconEqual;
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
        {strength && (
          <span
            className={`${styles.strength} ${styles[strength]}`}
            title={t(`menu.strength.${strength}`)}
          >
            <StrengthIcon size={18} aria-hidden="true" />
          </span>
        )}
        <IconButton label={t('menu.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {!neutral && <DiplomacyBlock view={view} other={other} send={send} />}
      {!neutral && onSelectArmy && holders.length > 0 && (
        <div className={styles.holders}>
          {holders.map((army) => (
            <button
              key={army.id}
              type="button"
              className={styles.holder}
              title={t('order.holder')}
              onClick={() => {
                onSelectArmy(army.id);
                onClose();
              }}
            >
              <span className={styles.holderDot} style={{ background: armyColor(army.number) }} />
              <span className={styles.holderName}>{armyName(army)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        {neutral ? (
          <OrderSplit
            tone="ghost"
            icon={<IconFlag size={20} aria-hidden="true" />}
            label="menu.occupy"
            tutorial="occupy"
            auto={free ? { kind: 'army', army: free } : null}
            disabled={free ? null : t('order.noFree')}
            armies={view.armies}
            onAuto={() => free && go(orderArmy(view, free, -1, 'attack', hex))}
            onPick={orderBy('attack')}
          />
        ) : (
          <>
            {holder === undefined ? (
              <OrderSplit
                tone="ghost"
                icon={<IconShield size={20} aria-hidden="true" />}
                label="menu.holdShort"
                tutorial="hold"
                auto={autoArmy(view, map, other, hex)}
                disabled={null}
                armies={view.armies}
                onAuto={() => go(autoOrder(view, map, other, 'hold', hex))}
                onPick={orderBy('hold')}
              />
            ) : holder.dir?.mode === 'attack' ? (
              <button
                type="button"
                className={styles.ghostButton}
                data-tutorial="hold"
                onClick={() => go(orderArmy(view, holder, other, 'hold'))}
              >
                <IconShield size={20} aria-hidden="true" />
                <span>{t('menu.defend')}</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.ghostButton}
                data-tutorial="hold"
                onClick={() => go({ t: 'holdBorder', target: other, soldiers: 0 })}
              >
                <IconShieldOff size={20} aria-hidden="true" />
                <span>{t('menu.unfront')}</span>
              </button>
            )}
            <button
              type="button"
              className={styles.attackButton}
              data-tutorial="attack"
              disabled={!atWar}
              aria-pressed={holder?.dir?.mode === 'attack'}
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
