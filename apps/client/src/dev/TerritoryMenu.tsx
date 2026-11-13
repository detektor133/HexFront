import {
  IconChevronDown,
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
import splitStyles from './OrderSplit.module.css';
import { OrderSplit } from './OrderSplit.tsx';
import { MarkMenu, SocialRow, WriteButton } from './SocialRow.tsx';
import styles from './TerritoryMenu.module.css';
import {
  DrawerMenu,
  PillMenu,
  RadialMenu,
  TilesMenu,
  type TerritoryAct,
  type TerritoryCtx,
} from './TerritoryVariants.tsx';
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
import { nextMenuStyle, useMenuStyle } from '../settings/menu-style.ts';
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
      // Другие формы меню (не окно) закрываются Esc и крестиком; клик мимо закрывает только окно.
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  const [swapOpen, setSwapOpen] = useState<number | null>(null);
  const [style, setStyle] = useMenuStyle();
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
  // Смена армии на фронте: прежняя снимается, новая встаёт в том же режиме (держит или наступает).
  const swapHolder = (from: ArmyView, to: ArmyView): void => {
    send({ t: 'holdBorder', target: other, soldiers: 0 });
    go(orderArmy(view, to, other, from.dir?.mode === 'attack' ? 'attack' : 'hold'));
  };
  // Армия, уже стоящая на эту страну: от неё зависят кнопки «Оборона» и «Снять с фронта».
  // Снятое с фронта направление остаётся у армии в режиме idle: оно уже ничего не держит.
  const onFront = (a: ArmyView): boolean => a.dir?.target === other && a.dir.mode !== 'idle';
  const holder = neutral ? undefined : view.armies.find(onFront);
  const holders = neutral ? [] : view.armies.filter(onFront);
  const strength = neutral ? null : strengthVs(view, other);
  const StrengthIcon =
    strength === 'stronger' ? IconChevronsUp : strength === 'weaker' ? IconChevronsDown : IconEqual;
  const strengthNode = strength ? (
    <span
      className={`${styles.strength} ${styles[strength]}`}
      title={t(`menu.strength.${strength}`)}
    >
      <StrengthIcon size={18} aria-hidden="true" />
    </span>
  ) : null;
  if (style !== 'menu') {
    const acts: TerritoryAct[] = [];
    if (neutral) {
      acts.push({
        id: 'occupy',
        label: t('menu.occupy'),
        icon: <IconFlag size={22} aria-hidden="true" />,
        run: () => free && go(orderArmy(view, free, -1, 'attack', hex)),
        disabled: !free,
        title: free ? t('menu.occupy') : t('order.noFree'),
        tutorial: 'occupy',
      });
    } else {
      const defend = holder?.dir?.mode === 'attack';
      acts.push({
        id: 'hold',
        label:
          holder === undefined
            ? t('menu.holdShort')
            : defend
              ? t('menu.defend')
              : t('menu.unfront'),
        icon:
          holder !== undefined && !defend ? (
            <IconShieldOff size={22} aria-hidden="true" />
          ) : (
            <IconShield size={22} aria-hidden="true" />
          ),
        run: () =>
          holder === undefined
            ? go(autoOrder(view, map, other, 'hold', hex))
            : defend
              ? go(orderArmy(view, holder, other, 'hold'))
              : go({ t: 'holdBorder', target: other, soldiers: 0 }),
        disabled: false,
        title: t('menu.holdShort'),
        tutorial: 'hold',
      });
      acts.push({
        id: 'attack',
        label: t('menu.attack'),
        icon: <IconSwords size={22} aria-hidden="true" />,
        run: () => go(autoOrder(view, map, other, 'attack', hex)),
        disabled: !atWar,
        title: atWar ? t('menu.attack') : t('army.attackNeedWar'),
        pressed: holder?.dir?.mode === 'attack',
        tutorial: 'attack',
      });
    }
    const ctx: TerritoryCtx = {
      name,
      color: neutral ? tokens.neutral.line : (tokens.players.palette[other]?.line ?? tokens.ui.ink),
      strength: strengthNode,
      acts,
      diplomacy: neutral ? null : (
        <>
          <DiplomacyBlock view={view} other={other} send={send} />
          <SocialRow other={other} hex={hex} />
        </>
      ),
      at,
      style,
      onStyle: () => setStyle(nextMenuStyle(style)),
      onClose,
    };
    const Form =
      style === 'pill'
        ? PillMenu
        : style === 'radial'
          ? RadialMenu
          : style === 'tiles'
            ? TilesMenu
            : DrawerMenu;
    return (
      <div ref={ref} className={styles.variantHost}>
        <Form ctx={ctx} />
      </div>
    );
  }
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
        {strengthNode}
        <button
          type="button"
          className={styles.styleSwitch}
          title={t('menu.styleSwitch')}
          aria-label={t('menu.styleSwitch')}
          onClick={() => setStyle(nextMenuStyle(style))}
        >
          1/5
        </button>
        {!neutral && <WriteButton other={other} />}
        <IconButton label={t('menu.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {!neutral && <DiplomacyBlock view={view} other={other} send={send} />}
      {!neutral && onSelectArmy && holders.length > 0 && (
        <div className={styles.holders}>
          {holders.map((army) => (
            <div key={army.id} className={styles.holderRow}>
              <button
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
              <button
                type="button"
                className={styles.holderArrow}
                aria-label={t('order.swapHolder')}
                aria-expanded={swapOpen === army.id}
                title={t('order.swapHolder')}
                onClick={() => setSwapOpen((now) => (now === army.id ? null : army.id))}
              >
                <IconChevronDown size={16} aria-hidden="true" />
              </button>
              {swapOpen === army.id && (
                <ul className={splitStyles.list} role="listbox" aria-label={t('order.swapHolder')}>
                  {view.armies
                    .filter((a) => a.id !== army.id)
                    .map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          className={splitStyles.item}
                          role="option"
                          aria-selected={false}
                          onClick={() => swapHolder(army, candidate)}
                        >
                          <span
                            className={splitStyles.swatch}
                            style={{ background: armyColor(candidate.number) }}
                          />
                          <span className={splitStyles.itemName}>{armyName(candidate)}</span>
                          {!isFree(candidate) && (
                            <span className={splitStyles.busy} title={t('order.busy')} />
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
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
            <MarkMenu other={other} hex={hex} />
          </>
        )}
      </div>
      {neutral && view.armies.length > 0 && view.armies.every((a) => !isFree(a)) && (
        <p className={styles.hint}>{t('order.noFree')}</p>
      )}
    </div>
  );
}
