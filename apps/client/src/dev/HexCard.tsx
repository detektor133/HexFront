import {
  IconArrowUp,
  IconBuildingCommunity,
  IconChevronsUp,
  IconPackage,
  IconRoute2,
  IconShield,
  IconX,
} from '@tabler/icons-react';
import { useId, useLayoutEffect, useRef } from 'react';

import {
  TERRAIN_NAMES,
  TICKS_PER_S,
  type Command,
  type MapStatic,
  type PlayerView,
  IMPROVEMENT_COST,
} from '@hexfront/sim';

import { DiplomacyBlock } from './DiplomacyBlock.tsx';
import styles from './HexCard.module.css';
import { measureCardHeight } from './card-measurement.ts';
import { visibleActions, type HexAction } from './hex-actions.ts';
import { reasonText, t, type MessageKey } from '../i18n/dict.ts';
import { formatFp, formatRate } from '../i18n/format.ts';
import type { Selection } from '../local/messages.ts';
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
    a.kind === 'fort'
      ? t('action.fortHint')
      : a.kind === 'fortUpgrade'
        ? t('action.fortUpgradeHint')
        : a.kind === 'depot'
          ? t('action.depotHint')
          : a.kind === 'depotUpgrade'
            ? t('action.depotUpgradeHint')
            : null;
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
          title={compact ? `${label}: ${props.blockedText ?? reasonText(a.blocked)}` : undefined}
        >
          {compact ? compactActionIcon(a.kind) : <span>{label}</span>}
          {compact && a.cost > 0 && <Price value={formatFp(a.cost)} ok={false} />}
        </button>
        <span id={reasonId} className={compact ? styles.srOnly : styles.hint}>
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
        data-tutorial={a.kind === 'foundCity' ? 'found-city' : undefined}
        disabled={!a.affordable}
        aria-label={compact ? label : undefined}
        {...(!a.affordable ? { 'aria-describedby': reasonId } : {})}
        title={
          compact
            ? a.affordable
              ? label
              : `${label}: ${reasonText('notEnoughGold')}`
            : (hint ?? undefined)
        }
        onMouseEnter={() => preview && props.onRoadPreview?.(preview)}
        onMouseLeave={clearPreview}
        onFocus={() => preview && props.onRoadPreview?.(preview)}
        onBlur={clearPreview}
        onClick={(event) => {
          props.send(a.cmd);
          clearPreview();
          // Отклик на нажатие: плитка «вдавливается» и возвращается — видно, что команда принята.
          event.currentTarget.animate?.(
            [{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }, { transform: 'scale(1)' }],
            { duration: 280, easing: 'ease-out' },
          );
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
        <span id={reasonId} className={styles.srOnly}>
          {reasonText('notEnoughGold')}
        </span>
      )}
    </div>
  );
}

// Иконка плитки — объект действия; цена показана на самой плитке, название — в title.
const ACTION_ICONS = {
  rebuild: IconRoute2,
  depot: IconPackage,
  depotUpgrade: IconPackage,
  fort: IconShield,
  fortUpgrade: IconShield,
  foundCity: IconBuildingCommunity,
  upgrade: IconChevronsUp,
  improve: IconArrowUp,
} as const;

function compactActionIcon(kind: HexAction['kind']): React.JSX.Element {
  const Icon = ACTION_ICONS[kind];
  return <Icon size={22} stroke={1.75} aria-hidden="true" />;
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
  return (
    <section ref={cardRef} className={styles.card} style={props.style} aria-label={title}>
      <div ref={contentRef} className={styles.cardBody}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.subtitle}>{ownerText}</p>
          </div>
          <IconButton className={styles.iconButton} label={t('card.close')} onClick={props.onClose}>
            <IconX className={styles.icon} size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <DiplomacyBlock view={view} other={owner} send={send} />
        <dl className={styles.stats}>
          <MetricRow
            name="population"
            value={`${formatFp(view.hexes.pop[s.hex] ?? 0)} / ${formatFp(s.popCap)}`}
          />
          <MetricRow name="growth" value={formatRate(view.hexes.growth[s.hex] ?? 0)} />
          {improvement > 0 && <MetricRow name="improvement" value={String(improvement)} />}
          {mine && <MetricRow name="supply" value={formatFp(c.supply)} />}
          {mine && <MetricRow name="gold" value={formatRate(c.goldPerS)} />}
        </dl>
        {/* Связь со столицей у самой столицы не показывается — она и есть узел сети. */}
        {hasLinkStatus && c && (
          <p className={c.link === 'isolated' ? styles.bad : styles.good}>
            {t(c.link === 'isolated' ? 'dev.economy.isolated' : 'dev.economy.connected')}
          </p>
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
        {actions.length > 0 && (
          <div className={styles.tiles}>
            {actions.map((a) => (
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
      </div>
    </section>
  );
}
