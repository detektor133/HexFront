import {
  IconCheck,
  IconHeartHandshake,
  IconLink,
  IconLinkOff,
  IconPeace,
  IconShield,
  IconUserMinus,
  IconSwords,
  IconX,
} from '@tabler/icons-react';

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

/** Вариант 2: главное действие по смыслу и подписанные договоры. */
function CardVariant(props: { readonly model: Model }): React.JSX.Element {
  const { relation, outgoing, other, send, allies } = props.model;
  const treaty = (kind: Treaty): React.JSX.Element | null =>
    RANK[kind] > RANK[relation] ? (
      <button
        key={kind}
        type="button"
        className={styles.text}
        disabled={outgoing}
        title={t(`diplomacy.${kind}` as MessageKey)}
        onClick={() => send({ t: 'proposeTreaty', target: other, kind })}
      >
        {t(`diplomacy.s.${kind}` as MessageKey)}
      </button>
    ) : null;
  return (
    <>
      <OfferRow model={props.model} />
      {relation === 'war' ? (
        <button
          type="button"
          className={`${styles.main} ${styles.calm}`}
          disabled={outgoing}
          onClick={() => send({ t: 'proposeTreaty', target: other, kind: 'peace' })}
        >
          <IconPeace size={18} aria-hidden="true" />
          {outgoing ? t('diplomacy.s.pending') : t('diplomacy.s.peace')}
        </button>
      ) : (
        <>
          <button
            type="button"
            data-tutorial="declare-war"
            className={`${styles.main} ${styles.danger}`}
            onClick={() => send({ t: 'declareWar', target: other })}
          >
            <IconSwords size={18} aria-hidden="true" />
            {t('diplomacy.s.war')}
          </button>
          {bound(relation) && <small className={styles.note}>{t('diplomacy.s.breach')}</small>}
          <div className={styles.group}>
            <span className={styles.groupLabel}>{t('diplomacy.s.treaties')}</span>
            <div className={styles.texts}>
              {TREATIES.map(treaty)}
              {relation === 'alliance' && allies >= 2 && (
                <button
                  type="button"
                  className={styles.text}
                  onClick={() => send({ t: 'proposeExpel', target: other })}
                >
                  {t('diplomacy.s.expel')}
                </button>
              )}
              {bound(relation) && (
                <button
                  type="button"
                  className={styles.text}
                  onClick={() => send({ t: 'breakTreaty', target: other })}
                >
                  {t('diplomacy.s.break')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

const STEPS: readonly Relation[] = ['war', 'peace', 'pact', 'defense', 'alliance'];

// Команда нажатия на ступень лестницы или null, если ступень недоступна.
export function stepCommand(relation: Relation, step: Relation, other: number): Command | null {
  if (step === relation) return null;
  if (step === 'war') return { t: 'declareWar', target: other };
  if (relation === 'war') {
    return step === 'peace' ? { t: 'proposeTreaty', target: other, kind: 'peace' } : null;
  }
  if (RANK[step] > RANK[relation]) {
    return step === 'peace' ? null : { t: 'proposeTreaty', target: other, kind: step };
  }
  // Ниже договора — только разрыв (мир); из «альянса» на «пакт» не спускаются.
  return step === 'peace' && bound(relation) ? { t: 'breakTreaty', target: other } : null;
}

function stepLabel(step: Relation, cmd: Command | null): string {
  if (cmd?.t === 'declareWar') return t('diplomacy.war');
  if (cmd?.t === 'breakTreaty') return t('diplomacy.break');
  if (cmd?.t === 'proposeTreaty') return t(`diplomacy.${cmd.kind}` as MessageKey);
  return t(`diplomacy.rel.${step}` as MessageKey);
}

/** Вариант 3: лестница отношений — ступень выше предлагается, ниже — разрыв или война. */
function LadderVariant(props: { readonly model: Model }): React.JSX.Element {
  const { relation, outgoing, other, send } = props.model;
  return (
    <>
      <OfferRow model={props.model} />
      <div className={styles.ladder} role="group" aria-label={t('diplomacy.title')}>
        {STEPS.map((step) => {
          const cmd = stepCommand(relation, step, other);
          const upward = cmd?.t === 'proposeTreaty';
          const label = stepLabel(step, cmd);
          return (
            <button
              key={step}
              type="button"
              data-tutorial={step === 'war' ? 'declare-war' : undefined}
              data-step={step}
              aria-current={step === relation ? 'step' : undefined}
              className={`${styles.step} ${step === relation ? styles.here : ''}`}
              disabled={cmd === null || (upward && outgoing)}
              title={label}
              aria-label={label}
              onClick={() => cmd && send(cmd)}
            >
              {t(`diplomacy.s.${step}` as MessageKey)}
            </button>
          );
        })}
      </div>
      {bound(relation) && <small className={styles.note}>{t('diplomacy.s.breach')}</small>}
    </>
  );
}

/**
 * Дипломатия с владельцем выбранной территории или столицы (CR-007): отношение, нарушения
 * договоров, ответ на предложение и действия. Вид окна выбирается в настройках и переключателем
 * в шапке: значки, карточка или лестница отношений.
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
      {variant === 'card' && <CardVariant model={model} />}
      {variant === 'ladder' && <LadderVariant model={model} />}
    </div>
  );
}
