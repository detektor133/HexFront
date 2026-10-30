import {
  IconClock,
  IconCoin,
  IconPackage,
  IconPercentage,
  IconTrophy,
  IconUsers,
} from '@tabler/icons-react';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  TAX_MAX,
  TAX_STEP,
  ATTRITION_THRESHOLD,
  FP,
  TICKS_PER_S,
  type Command,
  type Fp,
  type PlayerView,
} from '@hexfront/sim';

import styles from './Hud.module.css';
import { t } from '../i18n/dict.ts';
import {
  formatClock,
  formatCompact,
  formatFp,
  formatMult,
  formatPercent,
  formatRate,
  formatRateFull,
} from '../i18n/format.ts';
import { IconButton } from '../ui/icon-button.tsx';

type MetricIconName = 'people' | 'gold' | 'tax' | 'supply' | 'time' | 'place';

const METRIC_ICONS = {
  people: IconUsers,
  gold: IconCoin,
  tax: IconPercentage,
  supply: IconPackage,
  time: IconClock,
  place: IconTrophy,
} as const;

function MetricIcon(props: { name: MetricIconName; label: string }): React.JSX.Element {
  const Icon = METRIC_ICONS[props.name];
  return (
    <Icon
      size={14}
      stroke={2}
      title={props.label}
      aria-label={props.label}
      className={`${styles.metricIcon} ${props.name === 'gold' ? styles.goldIcon : ''}`}
    />
  );
}

function Slot(props: {
  icon: MetricIconName;
  label: string;
  value: string;
  fullValue?: string;
  rate?: string;
  fullRate?: string;
  negative?: boolean;
  tone?: 'success' | 'warning' | 'danger';
}): React.JSX.Element {
  return (
    <div className={styles.slot}>
      <MetricIcon name={props.icon} label={props.label} />
      <span className={styles.slotText}>
        <span
          className={`${styles.value} ${props.tone ? styles[props.tone] : ''}`}
          title={props.fullValue === props.value ? props.fullValue : undefined}
          aria-label={props.fullValue}
        >
          {props.fullValue !== undefined && props.fullValue !== props.value ? (
            <>
              <span className={styles.compactValue} title={props.fullValue}>
                {props.value}
              </span>
              <span className={styles.fullValue}>{props.fullValue}</span>
            </>
          ) : (
            props.value
          )}
        </span>
        {props.rate && (
          <span
            className={props.negative ? styles.rateBad : styles.rate}
            title={props.fullRate}
            aria-label={props.fullRate}
          >
            {props.rate}
          </span>
        )}
      </span>
    </div>
  );
}

// Шестерёнка Tabler Icons «settings» (art/ui.md: кнопки меню и настроек — Tabler, outline 1,75).
function SettingsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={styles.settingsIcon} aria-hidden="true">
      <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
      <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
    </svg>
  );
}

// Меню настроек: пока одна настройка — «Автокомандование» для новых армий (art/ui.md, CR-006).
function Settings(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
  fog: boolean;
  setFog: (on: boolean) => void;
  showFog: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const on = props.view.me.autoCommand;
  return (
    <div className={styles.settingsWrap}>
      <IconButton
        type="button"
        className={`${styles.settingsButton} ${styles.hudInteractive}`}
        label={t('settings.title')}
        aria-expanded={open}
        onClick={() =>
          setOpen((open) => {
            const next = !open;
            props.onOpenChange?.(next);
            return next;
          })
        }
      >
        <SettingsIcon />
      </IconButton>
      {open && (
        <div className={styles.settingsMenu} role="dialog" aria-label={t('settings.title')}>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            className={styles.switchRow}
            onClick={() => props.send({ t: 'setAutoCommand', on: !on })}
          >
            <span>{t('settings.autoCommand')}</span>
            <span className={on ? styles.switchOn : styles.switchOff}>
              <span className={styles.knob} />
            </span>
          </button>
          {props.showFog && (
            <button
              type="button"
              role="switch"
              aria-checked={props.fog}
              className={styles.switchRow}
              onClick={() => props.setFog(!props.fog)}
            >
              <span>{t('settings.fog')}</span>
              <span className={props.fog ? styles.switchOn : styles.switchOff}>
                <span className={styles.knob} />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerPauseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" className={styles.pauseIcon} aria-hidden="true">
      <path d="M4 3v8" />
      <path d="M10 3v8" />
    </svg>
  );
}

/** Верхняя полоса по ui.md «HUD»: люди, золото, налог с ползунком, снабжение, время, место, настройки. */
export function Hud(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
  fog: boolean;
  setFog: (on: boolean) => void;
  showFog?: boolean;
  onPause?: () => void;
  onHeight?: (height: number) => void;
  onPopupChange?: (open: boolean) => void;
  onTaxAnchor?: (anchor: { x: number; y: number }) => void;
  onTaxSize?: (size: { width: number; height: number }) => void;
  style?: React.CSSProperties | undefined;
  popupStyle?: React.CSSProperties | undefined;
}): React.JSX.Element | null {
  const [taxOpen, setTaxOpen] = useState(false);
  const hudRef = useRef<HTMLElement>(null);
  const taxButtonRef = useRef<HTMLButtonElement>(null);
  const taxPopupRef = useRef<HTMLDivElement>(null);
  const { view } = props;
  const me = view.players[view.playerId];
  if (!me) return null;
  const s = view.me;
  // Прирост золота в HUD — баланс: доход минус содержание отрядов (02-economy.md, «Золото»).
  const net = s.incomePerS - s.upkeepPerS;
  const supplyTone =
    s.supplyLevel < ATTRITION_THRESHOLD ? 'danger' : s.supplyLevel < FP ? 'warning' : 'success';
  const compactPlace = window.innerWidth <= 360;
  useLayoutEffect(() => {
    const hud = hudRef.current;
    if (!hud || !props.onHeight) return;
    const report = (entries: readonly ResizeObserverEntry[]): void =>
      props.onHeight?.(entries[0]?.contentRect.height ?? 0);
    const observer = new ResizeObserver(report);
    observer.observe(hud);
    return () => observer.disconnect();
  }, [props.onHeight]);
  useLayoutEffect(() => {
    const taxButton = taxButtonRef.current;
    if (!taxButton || !props.onTaxAnchor) return;
    const report = (): void => {
      const rect = taxButton.getBoundingClientRect();
      if (rect.width > 0) props.onTaxAnchor?.({ x: rect.left, y: rect.bottom });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(taxButton);
    return () => observer.disconnect();
  }, [props.onTaxAnchor]);
  useLayoutEffect(() => {
    const popup = taxPopupRef.current;
    const onTaxSize = props.onTaxSize;
    if (!popup || !onTaxSize) return;
    const report = (): void => {
      const rect = popup.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) onTaxSize({ width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(popup);
    return () => observer.disconnect();
  }, [props.onTaxSize, taxOpen]);
  return (
    <header ref={hudRef} className={styles.hud} style={props.style}>
      <Slot
        icon="people"
        label={t('hud.people')}
        value={formatCompact(s.popTotal)}
        fullValue={formatFp(s.popTotal)}
        rate={formatRate(s.popGrowthPerS)}
        fullRate={formatRateFull(s.popGrowthPerS)}
        negative={s.popGrowthPerS < 0}
      />
      <Slot
        icon="gold"
        label={t('hud.gold')}
        value={formatCompact(me.gold)}
        fullValue={formatFp(me.gold)}
        rate={formatRate(net)}
        fullRate={formatRateFull(net)}
        negative={net < 0}
      />
      <div className={styles.taxWrap}>
        <IconButton
          type="button"
          buttonRef={taxButtonRef}
          className={`${styles.taxButton} ${styles.hudInteractive}`}
          label={t('hud.tax')}
          aria-expanded={taxOpen}
          onClick={() =>
            setTaxOpen((open) => {
              const next = !open;
              props.onPopupChange?.(next);
              return next;
            })
          }
        >
          <MetricIcon name="tax" label={t('hud.tax')} />
          <span className={styles.slotText}>
            <span className={styles.value}>{formatPercent(me.taxTarget)}</span>
          </span>
        </IconButton>
        {taxOpen && (
          <div
            ref={taxPopupRef}
            className={styles.popover}
            style={props.popupStyle}
            role="dialog"
            aria-label={t('hud.tax')}
          >
            <input
              className={styles.slider}
              type="range"
              min={0}
              max={TAX_MAX}
              step={TAX_STEP}
              value={me.taxTarget}
              aria-label={t('hud.tax')}
              onChange={(e) => props.send({ t: 'setTax', rate: Number(e.target.value) as Fp })}
            />
            <p className={styles.hint}>
              {t('hud.taxNow')} {formatPercent(me.taxEffective)} → {formatPercent(me.taxTarget)}
            </p>
            <p className={styles.hint}>
              {t('hud.taxGrowth')} {formatMult(s.growthMultAtTarget)} · {t('hud.taxIncome')}{' '}
              {formatRate(s.incomeAtTargetPerS - s.upkeepPerS)}
            </p>
          </div>
        )}
      </div>
      <Slot
        icon="supply"
        label={t('hud.supply')}
        value={formatPercent(s.supplyLevel)}
        {...(supplyTone ? { tone: supplyTone } : {})}
      />
      <Slot icon="time" label={t('hud.time')} value={formatClock(view.tick, TICKS_PER_S)} />
      <Slot
        icon="place"
        label={t('hud.place')}
        value={compactPlace ? `#${s.place}` : `#${s.place}/${s.players}`}
      />
      {view.victoryHold && (
        <span
          className={styles.victoryHold}
        >{`${t('leaderboard.player')} ${view.victoryHold.player + 1} ${t('match.holdsCities')} · 00:${String(view.victoryHold.seconds).padStart(2, '0')}`}</span>
      )}
      <Settings
        view={view}
        send={props.send}
        fog={props.fog}
        setFog={props.setFog}
        showFog={props.showFog ?? true}
        {...(props.onPopupChange ? { onOpenChange: props.onPopupChange } : {})}
      />
      {props.onPause && (
        <IconButton
          type="button"
          className={`${styles.settingsButton} ${styles.hudInteractive}`}
          label={t('pause.title')}
          onClick={props.onPause}
        >
          <PlayerPauseIcon />
        </IconButton>
      )}
    </header>
  );
}
