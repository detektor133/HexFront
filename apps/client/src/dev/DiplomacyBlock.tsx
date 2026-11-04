import {
  IconCheck,
  IconHeartHandshake,
  IconLink,
  IconLinkOff,
  IconPeace,
  IconSwords,
  IconX,
} from '@tabler/icons-react';

import type { Command, PlayerView, Relation, TreatyKind } from '@hexfront/sim';

import styles from './DiplomacyBlock.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { IconButton } from '../ui/icon-button.tsx';

/** Подпись входящего предложения по виду договора. */
export function offerKey(kind: TreatyKind): MessageKey {
  if (kind === 'peace') return 'diplomacy.offerPeace';
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
  if (props.relation === 'alliance') return <IconLink size={size} aria-hidden="true" />;
  return null;
}

/**
 * Дипломатия с владельцем выбранной территории или столицы (CR-007): отношение, нарушения
 * договоров, ответ на предложение и кнопки войны, пакта, союза и разрыва; названия — в подсказках.
 */
export function DiplomacyBlock(props: {
  view: PlayerView;
  other: number;
  send: (cmd: Command) => void;
}): React.JSX.Element | null {
  const { view, other, send } = props;
  const d = view.diplomacy;
  if (!d || other < 0 || other === view.playerId) return null;
  const relation = d.relations[other] ?? 'peace';
  const violations = d.violations[other] ?? 0;
  const incoming = d.incoming.find((o) => o.from === other);
  const outgoing = d.outgoing.some((o) => o.to === other);
  const name = view.players[other]?.name ?? `${t('observer.player')} ${other + 1}`;
  const relationText = t(`diplomacy.rel.${relation}` as MessageKey);
  return (
    <div className={styles.block} aria-label={t('diplomacy.title')}>
      <div className={styles.row}>
        <span className={styles.relation} data-relation={relation} title={relationText}>
          <RelationIcon relation={relation} />
          <span>{relationText}</span>
        </span>
        <span className={styles.violations} title={`${t('diplomacy.violations')}: ${name}`}>
          <IconLinkOff size={14} aria-hidden="true" />
          {violations}
        </span>
      </div>
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
            onClick={() => send({ t: 'proposeTreaty', target: other, kind: 'peace' })}
          >
            <IconPeace size={18} aria-hidden="true" />
          </IconButton>
        )}
        {relation === 'peace' && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.pact')}
            disabled={outgoing}
            onClick={() => send({ t: 'proposeTreaty', target: other, kind: 'pact' })}
          >
            <IconHeartHandshake size={18} aria-hidden="true" />
          </IconButton>
        )}
        {(relation === 'peace' || relation === 'pact') && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.alliance')}
            disabled={outgoing}
            onClick={() => send({ t: 'proposeTreaty', target: other, kind: 'alliance' })}
          >
            <IconLink size={18} aria-hidden="true" />
          </IconButton>
        )}
        {(relation === 'pact' || relation === 'alliance') && (
          <IconButton
            className={styles.action}
            label={t('diplomacy.break')}
            onClick={() => send({ t: 'breakTreaty', target: other })}
          >
            <IconLinkOff size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
