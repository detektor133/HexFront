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
import { formatClock, formatFp, formatMult, formatPercent, formatRate } from '../i18n/format.ts';
import { IconButton } from '../ui/icon-button.tsx';

type MetricIconName = 'people' | 'gold' | 'tax' | 'supply' | 'time' | 'place';

function MetricIcon(props: { name: MetricIconName; label: string }): React.JSX.Element {
  const iconRef = useRef<SVGSVGElement>(null);
  const paths: Record<MetricIconName, readonly string[]> = {
    people: [
      'M4 12C4 10.34 5.34 9 7 9C8.66 9 10 10.34 10 12M5 7C5 5.9 5.9 5 7 5C8.1 5 9 5.9 9 7M10 12C10 10.34 11.34 9 13 9M11 7C11 5.9 11.9 5 13 5',
    ],
    gold: [
      'M3 4C3 2.9 4.8 2 7 2C9.2 2 11 2.9 11 4C11 5.1 9.2 6 7 6C4.8 6 3 5.1 3 4',
      'M3 4V10C3 11.1 4.8 12 7 12C9.2 12 11 11.1 11 10V4',
    ],
    tax: ['M4 10L10 4', 'M4 4h.01', 'M10 10h.01'],
    supply: ['M2 5H10L12 7V13H2ZM12 8H14V13H12M5 10H8'],
    time: [
      'M7 2C4.24 2 2 4.24 2 7C2 9.76 4.24 12 7 12C9.76 12 12 9.76 12 7C12 4.24 9.76 2 7 2M7 4V7L9 9',
    ],
    place: ['M7 2L9 5H12L9.5 7L10.5 11L7 9.5L3.5 11L4.5 7L2 5H5Z'],
  };
  useLayoutEffect(() => {
    iconRef.current?.setAttribute('title', props.label);
  }, [props.label]);
  return (
    <svg
      ref={iconRef}
      viewBox="0 0 14 14"
      aria-label={props.label}
      className={`${styles.metricIcon} ${props.name === 'gold' ? styles.goldIcon : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[props.name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function Slot(props: {
  icon: MetricIconName;
  label: string;
  value: string;
  rate?: string;
  negative?: boolean;
  tone?: 'success' | 'warning' | 'danger';
}): React.JSX.Element {
  return (
    <div className={styles.slot}>
      <MetricIcon name={props.icon} label={props.label} />
      <span className={`${styles.value} ${props.tone ? styles[props.tone] : ''}`}>
        {props.value}
      </span>
      {props.rate && (
        <span className={props.negative ? styles.rateBad : styles.rate}>{props.rate}</span>
      )}
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
        className={styles.settingsButton}
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
    const rect = taxButton.getBoundingClientRect();
    if (rect.width > 0) props.onTaxAnchor?.({ x: rect.left, y: rect.bottom });
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
        value={formatFp(s.popTotal)}
        rate={formatRate(s.popGrowthPerS)}
        negative={s.popGrowthPerS < 0}
      />
      <Slot
        icon="gold"
        label={t('hud.gold')}
        value={formatFp(me.gold)}
        rate={formatRate(net)}
        negative={net < 0}
      />
      <div className={styles.taxWrap}>
        <IconButton
          type="button"
          buttonRef={taxButtonRef}
          className={styles.taxButton}
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
          <span className={styles.value}>{formatPercent(me.taxTarget)}</span>
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
        <span>{`${t('leaderboard.player')} ${view.victoryHold.player + 1} ${t('match.holdsCities')} · 00:${String(view.victoryHold.seconds).padStart(2, '0')}`}</span>
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
          className={styles.settingsButton}
          label={t('pause.title')}
          onClick={props.onPause}
        >
          <PlayerPauseIcon />
        </IconButton>
      )}
    </header>
  );
}
