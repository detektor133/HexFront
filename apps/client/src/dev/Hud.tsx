import { useState } from 'react';

import {
  TAX_MAX,
  TAX_STEP,
  TICKS_PER_S,
  type Command,
  type Fp,
  type PlayerView,
} from '@hexfront/sim';

import styles from './Hud.module.css';
import { t } from '../i18n/dict.ts';
import { formatClock, formatFp, formatMult, formatPercent, formatRate } from '../i18n/format.ts';

function Slot(props: {
  label: string;
  value: string;
  rate?: string;
  negative?: boolean;
  title?: string;
}): React.JSX.Element {
  return (
    <div className={styles.slot} title={props.title}>
      <span className={styles.label}>{props.label}</span>
      <span className={styles.value}>{props.value}</span>
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
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const on = props.view.me.autoCommand;
  return (
    <div className={styles.settingsWrap}>
      <button
        type="button"
        className={styles.settingsButton}
        aria-expanded={open}
        aria-label={t('settings.title')}
        title={t('settings.title')}
        onClick={() => setOpen((o) => !o)}
      >
        <SettingsIcon />
      </button>
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
        </div>
      )}
    </div>
  );
}

/** Верхняя полоса по ui.md «HUD»: люди, золото, налог с ползунком, снабжение, время, место, настройки. */
export function Hud(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
  fog: boolean;
  setFog: (on: boolean) => void;
}): React.JSX.Element | null {
  const [taxOpen, setTaxOpen] = useState(false);
  const { view } = props;
  const me = view.players[view.playerId];
  if (!me) return null;
  const s = view.me;
  // Прирост золота в HUD — баланс: доход минус содержание отрядов (02-economy.md, «Золото»).
  const net = s.incomePerS - s.upkeepPerS;
  return (
    <header className={styles.hud}>
      <Slot
        label={t('hud.people')}
        value={formatFp(s.popTotal)}
        rate={formatRate(s.popGrowthPerS)}
      />
      <Slot
        label={t('hud.gold')}
        value={formatFp(me.gold)}
        rate={formatRate(net)}
        negative={net < 0}
      />
      <div className={styles.taxWrap}>
        <button
          type="button"
          className={styles.taxButton}
          aria-expanded={taxOpen}
          onClick={() => setTaxOpen((o) => !o)}
        >
          <span className={styles.label}>{t('hud.tax')}</span>
          <span className={styles.value}>{formatPercent(me.taxTarget)}</span>
        </button>
        {taxOpen && (
          <div className={styles.popover} role="dialog" aria-label={t('hud.tax')}>
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
      <Slot label={t('hud.supply')} value="—" title={t('hud.supplyLater')} />
      <Slot label={t('hud.time')} value={formatClock(view.tick, TICKS_PER_S)} />
      <Slot label={t('hud.place')} value={`#${s.place}/${s.players}`} />
      <Settings view={view} send={props.send} fog={props.fog} setFog={props.setFog} />
    </header>
  );
}
