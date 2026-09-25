import { useState } from 'react';

import {
  TERRAIN_NAMES,
  TICKS_PER_S,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import styles from './HexCard.module.css';
import { visibleActions, type HexAction } from './hex-actions.ts';
import { reasonText, t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatRate } from '../i18n/format.ts';
import type { Selection } from '../local/messages.ts';

function ActionButton(props: { a: HexAction; send: (cmd: Command) => void }): React.JSX.Element {
  const [why, setWhy] = useState(false);
  const { a } = props;
  const hint =
    a.kind === 'fort' ? t('action.fortHint') : a.kind === 'depot' ? t('action.depotHint') : null;
  return (
    <div className={styles.action}>
      <button
        type="button"
        className={styles.button}
        onClick={() => (a.affordable ? props.send(a.cmd) : setWhy(true))}
      >
        <span>{t(`action.${a.kind}` as MessageKey)}</span>
        <span className={a.affordable ? styles.price : styles.priceBad}>{formatFp(a.cost)}</span>
      </button>
      {hint && <span className={styles.hint}>{hint}</span>}
      {/* Причина — только по тапу (ui.md). */}
      {why && !a.affordable && <span className={styles.reason}>{reasonText('notEnoughGold')}</span>}
    </div>
  );
}

function Row(props: { label: string; value: string }): React.JSX.Element {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

/** Карточка выбранного гекса снизу слева (ui.md, «Карточка выбранного»). */
export function HexCard(props: {
  s: Selection;
  view: PlayerView;
  map: MapStatic;
  send: (cmd: Command) => void;
}): React.JSX.Element {
  const { s, view, map, send } = props;
  const owner = view.hexes.owner[s.hex] ?? -1;
  const ownerText =
    owner < 0
      ? t('dev.economy.neutral')
      : owner === view.playerId
        ? t('dev.economy.you')
        : t('dev.economy.rival');
  const terrain = TERRAIN_NAMES[map.terrain[s.hex] ?? 0] ?? 'plains';
  const c = s.city;
  // Снабжение, золото и связь со столицей есть только у своего города.
  const mine = c !== null && c.owner === view.playerId;
  const title = c
    ? `${c.isCapital ? t('card.capital') : t('card.city')} · ${t('card.level')} ${c.level}`
    : t(`terrain.${terrain}` as MessageKey);
  const job = view.constructions.find((x) => x.hex === s.hex && x.kind !== 'road');
  const road = view.constructions.find((x) => x.hex === s.hex && x.kind === 'road');
  const actions = visibleActions(s, owner, view.playerId, job !== undefined);
  const improvement = view.hexes.improvement[s.hex] ?? 0;
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <dl className={styles.stats}>
        <Row label={t('card.owner')} value={ownerText} />
        <Row
          label={t('card.pop')}
          value={`${formatFp(view.hexes.pop[s.hex] ?? 0)} / ${formatFp(s.popCap)}`}
        />
        <Row label={t('card.growth')} value={formatRate(view.hexes.growth[s.hex] ?? 0)} />
        {improvement > 0 && <Row label={t('card.improvementLevel')} value={String(improvement)} />}
        {mine && <Row label={t('card.supply')} value={formatFp(c.supply)} />}
        {mine && <Row label={t('card.gold')} value={formatRate(c.goldPerS)} />}
      </dl>
      {mine && (
        <p className={c.link === 'isolated' ? styles.bad : styles.good}>
          {t(c.link === 'isolated' ? 'dev.economy.isolated' : 'dev.economy.connected')}
        </p>
      )}
      {job && (
        <div className={styles.progress}>
          <p className={styles.progressText}>
            {t('card.building')}: {t(`build.${job.kind}` as MessageKey)} · {t('card.left')}{' '}
            {Math.ceil((job.totalTicks - job.progressTicks) / TICKS_PER_S)} {t('card.seconds')}
          </p>
          <div className={styles.bar}>
            <div
              className={styles.fill}
              style={{ width: `${(100 * job.progressTicks) / job.totalTicks}%` }}
            />
          </div>
        </div>
      )}
      {road && c?.roadJob && (
        <p className={styles.progressText}>
          {t('dev.economy.roadJob')} · {c.roadJob.built} {t('dev.economy.of')} {c.roadJob.total}
        </p>
      )}
      {actions.map((a) => (
        <ActionButton key={a.kind} a={a} send={send} />
      ))}
    </section>
  );
}
