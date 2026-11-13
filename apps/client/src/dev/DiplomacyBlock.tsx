import {
  IconCheck,
  IconDots,
  IconHeartHandshake,
  IconLink,
  IconLinkOff,
  IconPeace,
  IconShield,
  IconUserMinus,
  IconSwords,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';

import type { Command, PlayerView, Relation, TreatyKind } from '@hexfront/sim';

import styles from './DiplomacyBlock.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { NEIGHBOR_VIEWS, useNeighborView, type NeighborView } from '../settings/neighbor-view.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Подпись входящего предложения по виду договора. */
export function offerKey(kind: TreatyKind): MessageKey {
  if (kind === 'peace') return 'diplomacy.offerPeace';
  if (kind === 'defense') return 'diplomacy.offerDefense';
  return kind === 'pact' ? 'diplomacy.offerPact' : 'diplomacy.offerAlliance';
}

/** Значок отношения: мир — без значка (null). */
export function RelationIcon(props: {
  relation: Relation;
  size?: number;
}): React.JSX.Element | null {
  const size = props.size ?? 16;
  if (props.relation === 'war') return <IconSwords size={size} aria-hidden="true" />;
  if (props.relation === 'pact') return <IconHeartHandshake size={size} aria-hidden="true" />;
  if (props.relation === 'defense') return <IconShield size={size} aria-hidden="true" />;
  if (props.relation === 'alliance') return <IconLink size={size} aria-hidden="true" />;
  return null;
}

type Incoming = NonNullable<PlayerView['diplomacy']>['incoming'][number];

/** Всё, что нужно любому виду окна соседа. */
interface Model {
  readonly other: number;
  readonly send: (cmd: Command) => void;
  readonly relation: Relation;
  readonly violations: number;
  readonly incoming: Incoming | undefined;
  readonly outgoing: boolean;
  readonly allies: number;
}

const bound = (relation: Relation): boolean =>
  relation === 'pact' || relation === 'defense' || relation === 'alliance';

const RANK: Readonly<Record<Relation, number>> = {
  war: -1,
  peace: 0,
  pact: 1,
  defense: 2,
  alliance: 3,
};

type Treaty = 'pact' | 'defense' | 'alliance';
const TREATIES: readonly Treaty[] = ['pact', 'defense', 'alliance'];

/** Шапка: отношение, число нарушений и переключатель вида окна. */
function Head(props: {
  readonly model: Model;
  readonly variant: NeighborView;
  readonly onVariant: (view: NeighborView) => void;
}): React.JSX.Element {
  const { relation, violations } = props.model;
  const relationText = t(`diplomacy.rel.${relation}` as MessageKey);
  const next =
    NEIGHBOR_VIEWS[(NEIGHBOR_VIEWS.indexOf(props.variant) + 1) % NEIGHBOR_VIEWS.length] ?? 'icons';
  const switchText = `${t('diplomacy.s.view')}: ${t(`settings.neighbor.${next}` as MessageKey)}`;
  return (
    <div className={styles.row}>
      <span className={styles.relation} data-relation={relation} title={relationText}>
        <RelationIcon relation={relation} />
        <span>{relationText}</span>
      </span>
      <span className={styles.violations} title={t('diplomacy.violations')}>
        <IconLinkOff size={14} aria-hidden="true" />
        {props.variant === 'icons' ? violations : `${t('diplomacy.s.violations')}: ${violations}`}
      </span>
      <button
        type="button"
        className={styles.viewSwitch}
        title={switchText}
        aria-label={switchText}
        onClick={() => props.onVariant(next)}
      >
        {NEIGHBOR_VIEWS.indexOf(props.variant) + 1}/{NEIGHBOR_VIEWS.length}
      </button>
    </div>
  );
}

/** Входящее предложение с подписанными кнопками. */
function OfferRow(props: { readonly model: Model }): React.JSX.Element | null {
  const { incoming, other, send } = props.model;
  if (!incoming) return null;
  return (
    <div className={styles.offerCard} role="status">
      <span>{t(offerKey(incoming.kind))}</span>
      <div className={styles.offerButtons}>
        <button
          type="button"
          className={styles.yes}
          onClick={() => send({ t: 'answerTreaty', from: other, accept: true })}
        >
          <IconCheck size={16} aria-hidden="true" />
          {t('diplomacy.s.accept')}
        </button>
        <button
          type="button"
          className={styles.no}
          onClick={() => send({ t: 'answerTreaty', from: other, accept: false })}
        >
          <IconX size={16} aria-hidden="true" />
          {t('diplomacy.s.decline')}
        </button>
      </div>
    </div>
  );
}

/** Вариант 1: ряд значков (прежний вид). */
function IconsVariant(props: { readonly model: Model }): React.JSX.Element {
  const { relation, incoming, outgoing, other, send, allies } = props.model;
  const propose = (kind: TreatyKind): void => send({ t: 'proposeTreaty', target: other, kind });
  return (
    <>
      {incoming && (
        <div className={styles.offer} role="status">
          <span>{t(offerKey(incoming.kind))}</span>
          <IconButton
            className={styles.action}
            label={t('diplomacy.accept')}
            onClick={() => send({ t: 'answerTreaty', from: other, accept: true })}
          >
            <IconCheck size={18} aria-hidden="true" />
          </IconButton>
          <IconButton
            className={styles.action}
            label={t('diplomacy.decline')}
            onClick={() => send({ t: 'answerTreaty', from: other, accept: false })}
          >
            <IconX size={18} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      <div className={styles.actions}>
        {relation !== 'war' && (
          <IconButton
            data-tutorial="declare-war"
            className={styles.action}
            label={t('diplomacy.war')}
            onClick={() => send({ t: 'declareWar', target: other })}
          >
            <IconSwords size={18} aria-hidden="true" />
          </IconButton>
        )}
        {relation === 'war' && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.peace')}
            disabled={outgoing}
            onClick={() => propose('peace')}
          >
            <IconPeace size={18} aria-hidden="true" />
          </IconButton>
        )}
        {relation === 'peace' && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.pact')}
            disabled={outgoing}
            onClick={() => propose('pact')}
          >
            <IconHeartHandshake size={18} aria-hidden="true" />
          </IconButton>
        )}
        {(relation === 'peace' || relation === 'pact') && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.defense')}
            disabled={outgoing}
            onClick={() => propose('defense')}
          >
            <IconShield size={18} aria-hidden="true" />
          </IconButton>
        )}
        {(relation === 'peace' || relation === 'pact' || relation === 'defense') && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.alliance')}
            disabled={outgoing}
            onClick={() => propose('alliance')}
          >
            <IconLink size={18} aria-hidden="true" />
          </IconButton>
        )}
        {relation === 'alliance' && allies >= 2 && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.expel')}
            onClick={() => send({ t: 'proposeExpel', target: other })}
          >
            <IconUserMinus size={18} aria-hidden="true" />
          </IconButton>
        )}
        {bound(relation) && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.break')}
            onClick={() => send({ t: 'breakTreaty', target: other })}
          >
            <IconLinkOff size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </>
  );
}

/** Одно действие с соседом: общий список для всех видов окна, вид решает только компоновку. */
interface Act {
  readonly id: string;
  readonly cmd: Command;
  readonly label: string;
  readonly hint: string;
  readonly Icon: typeof IconSwords;
  /** `calm` — главное мирное действие, `danger` — война, остальное — обычные. */
  readonly tone: 'calm' | 'danger' | 'plain';
  readonly disabled: boolean;
}

const TREATY_ICONS = {
  pact: IconHeartHandshake,
  defense: IconShield,
  alliance: IconLink,
} as const;

/** Что можно сделать с соседом сейчас; в войне — только мир (договоры недоступны). */
function actionsOf(model: Model): Act[] {
  const { relation, outgoing, other, allies } = model;
  const label = (key: string): string => t(`diplomacy.s.${key}` as MessageKey);
  const hint = (key: string): string => t(`diplomacy.h.${key}` as MessageKey);
  if (relation === 'war') {
    return [
      {
        id: 'peace',
        cmd: { t: 'proposeTreaty', target: other, kind: 'peace' },
        label: outgoing ? label('pending') : label('peace'),
        hint: hint('peace'),
        Icon: IconPeace,
        tone: 'calm',
        disabled: outgoing,
      },
    ];
  }
  const out: Act[] = [];
  for (const kind of TREATIES) {
    if (RANK[kind] <= RANK[relation]) continue;
    out.push({
      id: kind,
      cmd: { t: 'proposeTreaty', target: other, kind },
      label: label(kind),
      hint: hint(kind),
      Icon: TREATY_ICONS[kind],
      tone: out.length === 0 ? 'calm' : 'plain',
      disabled: outgoing,
    });
  }
  if (relation === 'alliance' && allies >= 2) {
    out.push({
      id: 'expel',
      cmd: { t: 'proposeExpel', target: other },
      label: label('expel'),
      hint: hint('expel'),
      Icon: IconUserMinus,
      tone: 'plain',
      disabled: false,
    });
  }
  if (bound(relation)) {
    out.push({
      id: 'break',
      cmd: { t: 'breakTreaty', target: other },
      label: label('break'),
      hint: hint('break'),
      Icon: IconLinkOff,
      tone: 'plain',
      disabled: false,
    });
  }
  out.push({
    id: 'war',
    cmd: { t: 'declareWar', target: other },
    label: label('war'),
    hint: hint('war'),
    Icon: IconSwords,
    tone: 'danger',
    disabled: false,
  });
  return out;
}

/** Мирные действия (без войны) и война отдельно: у войны свой цвет и своё место. */
function split(acts: readonly Act[]): { readonly calm: Act[]; readonly war: Act | undefined } {
  return {
    calm: acts.filter((a) => a.tone !== 'danger'),
    war: acts.find((a) => a.tone === 'danger'),
  };
}

/** Кнопка действия: общая основа видов «фокус» и «вкладки». */
function ActButton(props: {
  readonly act: Act;
  readonly model: Model;
  readonly className: string | undefined;
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const { act, model } = props;
  return (
    <button
      type="button"
      data-tutorial={act.id === 'war' ? 'declare-war' : undefined}
      data-tone={act.tone}
      className={props.className}
      disabled={act.disabled}
      title={act.hint}
      onClick={() => model.send(act.cmd)}
    >
      <act.Icon size={18} aria-hidden="true" />
      {props.children ?? act.label}
    </button>
  );
}

/** Вид «список»: строки с названием и пояснением последствия, война — отдельно внизу. */
function ListVariant(props: { readonly model: Model }): React.JSX.Element {
  const { calm, war } = split(actionsOf(props.model));
  const row = (act: Act): React.JSX.Element => (
    <button
      key={act.id}
      type="button"
      data-tutorial={act.id === 'war' ? 'declare-war' : undefined}
      data-tone={act.tone}
      className={styles.listRow}
      disabled={act.disabled}
      onClick={() => props.model.send(act.cmd)}
    >
      <act.Icon size={20} aria-hidden="true" />
      <span className={styles.listText}>
        <b>{act.label}</b>
        <small>{act.hint}</small>
      </span>
    </button>
  );
  return (
    <>
      <OfferRow model={props.model} />
      <div className={styles.list}>{calm.map(row)}</div>
      {war && <div className={`${styles.list} ${styles.listWar}`}>{row(war)}</div>}
    </>
  );
}

/** Вид «фокус»: одно главное действие, война рядом значком, остальное — под «Ещё». */
function FocusVariant(props: { readonly model: Model }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { calm, war } = split(actionsOf(props.model));
  const primary = calm.find((a) => a.tone === 'calm');
  const rest = calm.filter((a) => a !== primary);
  return (
    <>
      <OfferRow model={props.model} />
      <div className={styles.focusBar}>
        {primary && <ActButton act={primary} model={props.model} className={styles.focusMain} />}
        {war && (
          <ActButton act={war} model={props.model} className={styles.focusWar}>
            {primary ? null : war.label}
          </ActButton>
        )}
        {rest.length > 0 && primary && (
          <button
            type="button"
            className={styles.focusMore}
            aria-expanded={open}
            title={t('diplomacy.s.more')}
            aria-label={t('diplomacy.s.more')}
            onClick={() => setOpen((value) => !value)}
          >
            <IconDots size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {(open || !primary) && rest.length > 0 && (
        <div className={styles.texts}>
          {rest.map((act) => (
            <ActButton key={act.id} act={act} model={props.model} className={styles.text} />
          ))}
        </div>
      )}
      {bound(props.model.relation) && (
        <small className={styles.note}>{t('diplomacy.s.breach')}</small>
      )}
    </>
  );
}

/** Вид «плитки»: сетка с подписями под значками, война — широкой плиткой снизу. */
function TilesVariant(props: { readonly model: Model }): React.JSX.Element {
  const { calm, war } = split(actionsOf(props.model));
  const tile = (act: Act): React.JSX.Element => (
    <button
      key={act.id}
      type="button"
      data-tutorial={act.id === 'war' ? 'declare-war' : undefined}
      data-tone={act.tone}
      className={styles.tile}
      disabled={act.disabled}
      title={act.hint}
      onClick={() => props.model.send(act.cmd)}
    >
      <act.Icon size={22} aria-hidden="true" />
      <span>{act.label}</span>
    </button>
  );
  return (
    <>
      <OfferRow model={props.model} />
      <div className={styles.tiles}>{calm.map(tile)}</div>
      {war && <div className={styles.tilesWar}>{tile(war)}</div>}
    </>
  );
}

/** Вид «вкладки»: «Договоры» и «Война» — показано только то, что сейчас нужно. */
function TabsVariant(props: { readonly model: Model }): React.JSX.Element {
  const [picked, setPicked] = useState<'treaties' | 'war' | null>(null);
  const { calm, war } = split(actionsOf(props.model));
  // В войне открыта вкладка «Война» (там мир), в мире — «Договоры»: выбор игрока важнее.
  const tab = picked ?? (props.model.relation === 'war' ? 'war' : 'treaties');
  const tabButton = (id: 'treaties' | 'war', text: string): React.JSX.Element => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`${styles.tab} ${tab === id ? styles.tabOn : ''}`}
      onClick={() => setPicked(id)}
    >
      {text}
    </button>
  );
  const peace = props.model.relation === 'war' ? calm : [];
  return (
    <>
      <OfferRow model={props.model} />
      <div className={styles.tabBar} role="tablist">
        {tabButton('treaties', t('diplomacy.s.tabTreaties'))}
        {tabButton('war', t('diplomacy.s.tabWar'))}
      </div>
      {tab === 'treaties' ? (
        <div className={styles.texts}>
          {props.model.relation === 'war' && (
            <small className={styles.note}>{t('diplomacy.s.atWar')}</small>
          )}
          {(props.model.relation === 'war' ? [] : calm).map((act) => (
            <ActButton key={act.id} act={act} model={props.model} className={styles.text} />
          ))}
        </div>
      ) : (
        <div className={styles.group}>
          {peace.map((act) => (
            <ActButton
              key={act.id}
              act={act}
              model={props.model}
              className={`${styles.main} ${styles.calm}`}
            />
          ))}
          {war && (
            <ActButton
              act={war}
              model={props.model}
              className={`${styles.main} ${styles.danger}`}
            />
          )}
          {bound(props.model.relation) && (
            <small className={styles.note}>{t('diplomacy.s.breach')}</small>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Дипломатия с владельцем выбранной территории или столицы (CR-007): отношение, нарушения
 * договоров, ответ на предложение и действия. Вид окна выбирается в настройках и переключателем
 * в шапке: значки, список, фокус, плитки или вкладки.
 */
export function DiplomacyBlock(props: {
  view: PlayerView;
  other: number;
  send: (cmd: Command) => void;
}): React.JSX.Element | null {
  const { view, other, send } = props;
  const [variant, setVariant] = useNeighborView();
  const d = view.diplomacy;
  if (!d || other < 0 || other === view.playerId) return null;
  const model: Model = {
    other,
    send,
    relation: d.relations[other] ?? 'peace',
    violations: d.violations[other] ?? 0,
    incoming: d.incoming.find((o) => o.from === other),
    outgoing: d.outgoing.some((o) => o.to === other),
    allies: d.allies.length,
  };
  return (
    <div className={styles.block} aria-label={t('diplomacy.title')} data-variant={variant}>
      <Head model={model} variant={variant} onVariant={setVariant} />
      {variant === 'icons' && <IconsVariant model={model} />}
      {variant === 'list' && <ListVariant model={model} />}
      {variant === 'focus' && <FocusVariant model={model} />}
      {variant === 'tiles' && <TilesVariant model={model} />}
      {variant === 'tabs' && <TabsVariant model={model} />}
    </div>
  );
}
