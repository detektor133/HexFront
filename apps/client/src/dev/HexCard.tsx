import { IconArrowUp, IconPackage, IconRoute2, IconUserPlus, IconX } from '@tabler/icons-react';
import { Fragment, useId, useLayoutEffect, useRef, useState } from 'react';

import {
  TERRAIN_NAMES,
  TICKS_PER_S,
  type Command,
  type MapStatic,
  type PlayerView,
  type UnitType,
  IMPROVEMENT_COST,
  RECRUIT_MIN,
} from '@hexfront/sim';

import styles from './HexCard.module.css';
import { measureCardHeight } from './card-measurement.ts';
import { visibleActions, type HexAction } from './hex-actions.ts';
import { UnitGlyph } from './unit-glyph.tsx';
import { reasonText, t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatRate, formatSoldiers } from '../i18n/format.ts';
import type { RecruitAmount, RecruitOption, Selection } from '../local/messages.ts';
import { GoldIcon } from '../ui/gold-icon.tsx';
import { IconButton } from '../ui/icon-button.tsx';
import { MetricIcon, MetricRow } from '../ui/metric-icon.tsx';

function ActionButton(props: {
  a: HexAction;
  send: (cmd: Command) => void;
  blockedText: string | null;
  compact?: boolean;
  onRoadPreview?: (path: readonly number[] | null) => void;
}): React.JSX.Element | null {
  const { a } = props;
  const reasonId = useId();
  // Что даёт постройка — во всплывающей подсказке, не текстом в карточке (04/T16).
  const hint =
    a.kind === 'fort' ? t('action.fortHint') : a.kind === 'depot' ? t('action.depotHint') : null;
  const preview = a.kind === 'rebuild' ? a.previewPath : undefined;
  const label = t(`action.${a.kind}` as MessageKey);
  const compact = props.compact === true;
  const clearPreview = (): void => props.onRoadPreview?.(null);
  if (a.blocked) {
    return (
      <div className={`${styles.action}${compact ? ` ${styles.levelAction}` : ''}`}>
        <button
          type="button"
          className={`${styles.button} ${styles.muted}`}
          disabled
          aria-label={compact ? label : undefined}
          aria-describedby={reasonId}
          title={compact ? label : undefined}
        >
          {compact ? compactActionIcon(a.kind) : <span>{label}</span>}
          {compact && a.cost > 0 && <Price value={formatFp(a.cost)} ok={false} />}
        </button>
        <span id={reasonId} className={compact ? styles.reason : styles.hint}>
          {props.blockedText ?? reasonText(a.blocked)}
        </span>
      </div>
    );
  }
  return (
    <div className={`${styles.action}${compact ? ` ${styles.levelAction}` : ''}`}>
      <button
        type="button"
        className={`${styles.button}${a.affordable ? ` ${styles.accent}` : ''}`}
        disabled={!a.affordable}
        aria-label={compact ? label : undefined}
        {...(!a.affordable ? { 'aria-describedby': reasonId } : {})}
        title={compact ? label : (hint ?? undefined)}
        onMouseEnter={() => preview && props.onRoadPreview?.(preview)}
        onMouseLeave={clearPreview}
        onFocus={() => preview && props.onRoadPreview?.(preview)}
        onBlur={clearPreview}
        onClick={() => {
          props.send(a.cmd);
          clearPreview();
        }}
      >
        {compact ? compactActionIcon(a.kind) : <span>{label}</span>}
        {compact ? (
          a.cost > 0 && <Price value={formatFp(a.cost)} ok={a.affordable} />
        ) : (
          <Price value={formatFp(a.cost)} ok={a.affordable} />
        )}
      </button>
      {!a.affordable && (
        <span id={reasonId} className={styles.reason}>
          {reasonText('notEnoughGold')}
        </span>
      )}
    </div>
  );
}

function compactActionIcon(kind: HexAction['kind']): React.JSX.Element {
  return kind === 'rebuild' ? (
    <IconRoute2 size={14} aria-hidden="true" />
  ) : kind === 'depot' ? (
    <IconPackage size={14} aria-hidden="true" />
  ) : (
    <IconArrowUp size={14} aria-hidden="true" />
  );
}

// Набор в своём городе (03/T12): доступный — с ценой; не хватает только золота — с ценой и
// причиной; недоступный по правилам — disabled с постоянной причиной (ui.md).

// Цена со значком золота — монета по сетке иконок (линия, round), цвет — как у числа.
function Price(props: { value: string; ok: boolean }): React.JSX.Element {
  return (
    <span className={props.ok ? styles.price : styles.priceBad}>
      <GoldIcon {...(styles.coin ? { className: styles.coin } : {})} />
      {props.value}
    </span>
  );
}

function RecruitButton(props: {
  options: readonly RecruitOption[];
  send: (cmd: Command) => void;
  cityId: number;
}): React.JSX.Element | null {
  const reasonId = useId();
  const [type, setType] = useState<UnitType>(
    props.options.some((option) => option.type === 'infantry')
      ? 'infantry'
      : (props.options[0]?.type ?? 'infantry'),
  );
  const [soldiers, setSoldiers] = useState(RECRUIT_MIN);
  const o = props.options.find((option) => option.type === type);
  if (!o) return null;
  const amount: RecruitAmount | undefined = o.amounts.find((x) => x.soldiers === soldiers);
  const current =
    amount ??
    o.amounts.reduce<RecruitAmount | undefined>(
      (nearest, candidate) =>
        !nearest || Math.abs(candidate.soldiers - soldiers) < Math.abs(nearest.soldiers - soldiers)
          ? candidate
          : nearest,
      undefined,
    );
  const selectedSoldiers = current?.soldiers ?? RECRUIT_MIN;
  const check = current?.check;
  const label = t(`unit.${type}` as MessageKey);
  const reason = check
    ? check.ok
      ? null
      : reasonText(check.reason)
    : reasonText('notEnoughPeople');
  const blocked = !check || (!check.ok && check.reason !== 'notEnoughGold');
  return (
    <div className={styles.action}>
      <div className={styles.recruitControl}>
        <div className={styles.recruitTypes} role="group" aria-label={t('recruit.type')}>
          {props.options.map((option) => {
            const typeLabel = t(`unit.${option.type}` as MessageKey);
            return (
              <button
                key={option.type}
                type="button"
                className={styles.recruitType}
                aria-label={typeLabel}
                aria-pressed={option.type === type}
                disabled={option.amounts.length === 0}
                title={typeLabel}
                onClick={() => {
                  setType(option.type);
                  const nearest = option.amounts.reduce<RecruitAmount | undefined>(
                    (best, candidate) =>
                      !best ||
                      Math.abs(candidate.soldiers - selectedSoldiers) <
                        Math.abs(best.soldiers - selectedSoldiers)
                        ? candidate
                        : best,
                    undefined,
                  );
                  if (nearest) setSoldiers(nearest.soldiers);
                }}
              >
                <UnitGlyph className={styles.glyph} type={option.type} />
              </button>
            );
          })}
        </div>
        <label className={styles.recruitRange}>
          <span>{label}</span>
          <input
            type="range"
            min={o.amounts[0]?.soldiers ?? RECRUIT_MIN}
            max={o.amounts.at(-1)?.soldiers ?? RECRUIT_MIN}
            step={
              o.amounts[1] ? o.amounts[1].soldiers - (o.amounts[0]?.soldiers ?? 0) : RECRUIT_MIN
            }
            value={selectedSoldiers}
            disabled={o.amounts.length === 0}
            aria-label={t('recruit.amount')}
            onChange={(event) => {
              const next = o.amounts.find((x) => x.soldiers === Number(event.currentTarget.value));
              if (next) setSoldiers(next.soldiers);
            }}
          />
          <span>{formatSoldiers(selectedSoldiers)}</span>
        </label>
        {check?.cost !== undefined && <Price value={formatFp(check.cost)} ok={check.ok} />}
        {check?.timeS !== undefined && (
          <span className={styles.time}>
            <MetricIcon name="time" />
            {formatFp(check.timeS)} {t('card.seconds')}
          </span>
        )}
        <button
          type="button"
          className={`${styles.button}${check?.ok ? ` ${styles.accent}` : ''}${blocked ? ` ${styles.muted}` : ''}`}
          disabled={!check?.ok}
          aria-label={t('recruit.queue')}
          {...(reason ? { 'aria-describedby': reasonId } : {})}
          title={t('recruit.queue')}
          onClick={() =>
            props.send({ t: 'recruit', cityId: props.cityId, type, soldiers: selectedSoldiers })
          }
        >
          <IconUserPlus size={16} aria-hidden="true" />
        </button>
      </div>
      {reason && (
        <span id={reasonId} className={styles.reason}>
          {reason}
        </span>
      )}
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
  onClose?: () => void;
  onRoadPreview?: (path: readonly number[] | null) => void;
  onHeight?: (px: number) => void;
  style?: React.CSSProperties | undefined;
}): React.JSX.Element {
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !props.onHeight) return;
    const card = cardRef.current;
    if (!card) return;
    const report = (entries: readonly ResizeObserverEntry[]): void =>
      props.onHeight?.(measureCardHeight(card, content, entries[0]));
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  }, [props.onHeight]);
  const { s, view, map, send } = props;
  const owner = view.hexes.owner[s.hex] ?? -1;
  const ownerText =
    owner < 0
      ? t('dev.economy.neutral')
      : owner === view.playerId
        ? t('dev.economy.you')
        : t('dev.economy.rival');
  const terrain = TERRAIN_NAMES[map.terrain[s.hex] ?? 0] ?? 'plains';
  const visible = view.hexes.visible[s.hex] === 1;
  const c = visible ? s.city : null;
  // Снабжение, золото и связь со столицей есть только у своего города.
  const mine = c !== null && c.owner === view.playerId;
  const hasLinkStatus = mine && c !== null && !c.isCapital;
  const title = c
    ? `${c.isCapital ? t('card.capital') : t('card.city')} · ${t('card.level')} ${c.level}`
    : t(`terrain.${terrain}` as MessageKey);
  const job = visible
    ? view.constructions.find((x) => x.hex === s.hex && x.kind !== 'road')
    : undefined;
  const road = visible
    ? view.constructions.find((x) => x.hex === s.hex && x.kind === 'road')
    : undefined;
  const improvement = visible ? (view.hexes.improvement[s.hex] ?? 0) : 0;
  const foundCityCost = view.me.foundCityCost;
  const actions = visibleActions(
    s,
    visible ? owner : -1,
    view.playerId,
    job !== undefined,
    foundCityCost,
    IMPROVEMENT_COST[Math.min(improvement, IMPROVEMENT_COST.length - 1)] ?? 0,
  );
  const upgrade = actions.find((action) => action.kind === 'upgrade');
  const fort = actions.find((action) => action.kind === 'fort');
  const recruiting = visible && c ? view.recruits.find((r) => r.cityId === c.id) : undefined;
  return (
    <section ref={cardRef} className={styles.card} style={props.style} aria-label={title}>
      <div ref={contentRef} className={styles.cardBody}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton className={styles.iconButton} label={t('card.close')} onClick={props.onClose}>
            <IconX className={styles.icon} size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <dl className={styles.stats}>
          <Row label={t('card.owner')} value={ownerText} />
          {c && (
            <>
              <dt>{t('card.level')}</dt>
              <dd className={styles.levelValue}>
                <span>{c.level}</span>
                {upgrade && <ActionButton a={upgrade} send={send} blockedText={null} compact />}
              </dd>
            </>
          )}
          <MetricRow
            name="population"
            value={`${formatFp(view.hexes.pop[s.hex] ?? 0)} / ${formatFp(s.popCap)}`}
          />
          <MetricRow name="growth" value={formatRate(view.hexes.growth[s.hex] ?? 0)} />
          {(improvement > 0 || actions.some((a) => a.kind === 'improve')) && (
            <>
              <dt>
                <MetricIcon name="improvement" />
              </dt>
              <dd className={styles.levelValue}>
                <span>{improvement}</span>
                {actions
                  .filter((a) => a.kind === 'improve')
                  .map((a) => (
                    <ActionButton
                      key={a.kind}
                      a={a}
                      send={send}
                      blockedText={blockedText(a, s, view)}
                      compact
                    />
                  ))}
              </dd>
            </>
          )}
          {fort && (
            <>
              <dt aria-hidden="true" />
              <dd className={styles.levelValue}>
                <MetricIcon name="fort" />
                <ActionButton
                  a={fort}
                  send={send}
                  blockedText={blockedText(fort, s, view)}
                  compact
                />
              </dd>
            </>
          )}
          {actions
            .filter((a) => a.kind === 'depot')
            .map((a) => (
              <Fragment key={a.kind}>
                <dt aria-hidden="true" />
                <dd className={`${styles.levelValue} ${styles.depotValue}`}>
                  <MetricIcon name="supply" />
                  <ActionButton a={a} send={send} blockedText={blockedText(a, s, view)} compact />
                </dd>
              </Fragment>
            ))}
          {mine && <MetricRow name="supply" value={formatFp(c.supply)} />}
          {mine && <MetricRow name="gold" value={formatRate(c.goldPerS)} />}
        </dl>
        {/* Связь со столицей у самой столицы не показывается — она и есть узел сети. */}
        {hasLinkStatus && c && (
          <div className={styles.linkStatus}>
            <p className={c.link === 'isolated' ? styles.bad : styles.good}>
              {t(c.link === 'isolated' ? 'dev.economy.isolated' : 'dev.economy.connected')}
            </p>
            {actions
              .filter((a) => a.kind === 'rebuild')
              .map((a) => (
                <ActionButton
                  key={a.kind}
                  a={a}
                  send={send}
                  blockedText={blockedText(a, s, view)}
                  compact
                  {...(props.onRoadPreview ? { onRoadPreview: props.onRoadPreview } : {})}
                />
              ))}
          </div>
        )}
        {job && (
          <div className={styles.progress}>
            <p className={styles.progressText}>
              {t('card.building')}: {t(`build.${job.kind}` as MessageKey)} · {t('card.left')}{' '}
              <MetricIcon name="time" />{' '}
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
        {actions
          .filter(
            (a) =>
              a.kind !== 'upgrade' &&
              a.kind !== 'improve' &&
              a.kind !== 'fort' &&
              a.kind !== 'depot' &&
              !(hasLinkStatus && a.kind === 'rebuild'),
          )
          .map((a) => (
            <ActionButton
              key={a.kind}
              a={a}
              send={send}
              blockedText={blockedText(a, s, view)}
              {...(a.kind === 'foundCity' || a.kind === 'improve' || (c && a.kind === 'rebuild')
                ? { compact: true }
                : {})}
              {...(props.onRoadPreview ? { onRoadPreview: props.onRoadPreview } : {})}
            />
          ))}
        {recruiting && (
          <p className={styles.progressText}>
            {t('recruit.queue')}: {t(`unit.${recruiting.type}` as MessageKey)}{' '}
            {formatSoldiers(recruiting.soldiers)} · <MetricIcon name="time" /> {t('card.left')}{' '}
            {Math.ceil((recruiting.totalTicks - recruiting.progressTicks) / TICKS_PER_S)}{' '}
            {t('card.seconds')}
          </p>
        )}
        {c && !recruiting && <RecruitButton options={s.recruit} send={send} cityId={c.id} />}
      </div>
    </section>
  );
}
