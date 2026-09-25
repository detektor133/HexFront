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

/** Верхняя полоса по ui.md «HUD»: люди, золото, налог с ползунком, снабжение, время, место. */
export function Hud(props: {
  view: PlayerView;
  send: (cmd: Command) => void;
}): React.JSX.Element | null {
  const [taxOpen, setTaxOpen] = useState(false);
  const { view } = props;
  const me = view.players[view.playerId];
  if (!me) return null;
  const s = view.me;
  // Прирост золота в HUD — баланс: доход минус содержание армий (02-economy.md, «Золото»).
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
    </header>
  );
}
