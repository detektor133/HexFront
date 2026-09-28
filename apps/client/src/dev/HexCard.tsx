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
import { formatFp, formatRate, formatSoldiers } from '../i18n/format.ts';
import type { RecruitOption, Selection } from '../local/messages.ts';

function ActionButton(props: {
  a: HexAction;
  send: (cmd: Command) => void;
  blockedText: string | null;
}): React.JSX.Element {
  const [why, setWhy] = useState(false);
  const { a } = props;
  // Что даёт постройка — во всплывающей подсказке, не текстом в карточке (04/T16).
  const hint =
    a.kind === 'fort' ? t('action.fortHint') : a.kind === 'depot' ? t('action.depotHint') : null;
  // Недоступное по правилам «Основать город»: приглушённая кнопка и причина строкой (ui.md).
  if (a.blocked) {
    return (
      <div className={styles.action}>
        <button type="button" className={`${styles.button} ${styles.muted}`} disabled>
          <span>{t(`action.${a.kind}` as MessageKey)}</span>
        </button>
        <span className={styles.hint}>{props.blockedText}</span>
      </div>
    );
  }
  return (
    <div className={styles.action}>
      <button
        type="button"
        className={styles.button}
        title={hint ?? undefined}
        onClick={() => (a.affordable ? props.send(a.cmd) : setWhy(true))}
      >
        <span>{t(`action.${a.kind}` as MessageKey)}</span>
        <Price value={formatFp(a.cost)} ok={a.affordable} />
      </button>
      {/* Причина — только по тапу (ui.md). */}
      {why && !a.affordable && <span className={styles.reason}>{reasonText('notEnoughGold')}</span>}
    </div>
  );
}

// Набор в своём городе (03/T12): доступный — с ценой; не хватает только золота — с ценой и
// причиной по тапу; недоступный по правилам — скрыт (ui.md).

// Глиф рода войск в сетке 14×14 — как на фишке (art/units.md, «Глифы»).
function UnitGlyph(props: { type: RecruitOption['type'] }): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" className={styles.glyph} aria-hidden="true">
      {props.type === 'infantry' && <polyline points="2,10 7,5 12,10" />}
      {props.type === 'armor' && <polygon points="7,2 12,7 7,12 2,7" />}
      {props.type === 'artillery' && (
        <>
          <path d="M2 10 A5 5 0 0 1 12 10" />
          <circle cx="7" cy="10" r="1.75" className={styles.glyphDot} />
        </>
      )}
    </svg>
  );
}

// Цена со значком золота — монета по сетке иконок (линия, round), цвет — как у числа.
function Price(props: { value: string; ok: boolean }): React.JSX.Element {
  return (
    <span className={props.ok ? styles.price : styles.priceBad}>
      <svg viewBox="0 0 14 14" className={styles.coin} aria-hidden="true">
        <circle cx="7" cy="7" r="5" />
        <line x1="7" y1="4.5" x2="7" y2="9.5" />
      </svg>
      {props.value}
    </span>
  );
}

function RecruitButton(props: {
  o: RecruitOption;
  send: (cmd: Command) => void;
  cityId: number;
}): React.JSX.Element | null {
  const [why, setWhy] = useState(false);
  const { o } = props;
  const ok = o.check.ok;
  const cost = o.check.cost;
  if (!ok && o.check.reason !== 'notEnoughGold') return null;
  return (
    <div className={styles.action}>
      <button
        type="button"
        className={styles.button}
        aria-label={`${t(`unit.${o.type}` as MessageKey)} ${formatSoldiers(o.soldiers)}`}
        title={t(`unit.${o.type}` as MessageKey)}
        onClick={() =>
          ok
            ? props.send({ t: 'recruit', cityId: props.cityId, type: o.type, soldiers: o.soldiers })
            : setWhy(true)
        }
      >
        <span className={styles.recruit}>
          <UnitGlyph type={o.type} />
          {formatSoldiers(o.soldiers)}
        </span>
        {cost !== undefined && <Price value={formatFp(cost)} ok={ok} />}
      </button>
      {why && !ok && <span className={styles.reason}>{reasonText('notEnoughGold')}</span>}
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

// Причина недоступности основания: для населения — с числами, иначе — общий текст отказа.
function blockedText(a: HexAction, s: Selection, view: PlayerView): string | null {
  if (!a.blocked) return null;
  if (a.blocked !== 'popTooLow' || s.popCap <= 0) return reasonText(a.blocked);
  const percent = Math.floor((100 * (view.hexes.pop[s.hex] ?? 0)) / s.popCap);
  return t('found.popTooLow').replace('{pop}', String(percent));
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
  const recruiting = c ? view.recruits.find((r) => r.cityId === c.id) : undefined;
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
      {/* Связь со столицей у самой столицы не показывается — она и есть узел сети. */}
      {mine && !c.isCapital && (
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
        <ActionButton key={a.kind} a={a} send={send} blockedText={blockedText(a, s, view)} />
      ))}
      {recruiting && (
        <p className={styles.progressText}>
          {t('recruit.queue')}: {t(`unit.${recruiting.type}` as MessageKey)}{' '}
          {formatSoldiers(recruiting.soldiers)} · {t('card.left')}{' '}
          {Math.ceil((recruiting.totalTicks - recruiting.progressTicks) / TICKS_PER_S)}{' '}
          {t('card.seconds')}
        </p>
      )}
      {c &&
        !recruiting &&
        s.recruit.map((o) => <RecruitButton key={o.type} o={o} send={send} cityId={c.id} />)}
    </section>
  );
}
