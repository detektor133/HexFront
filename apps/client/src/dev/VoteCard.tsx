import { IconCheck, IconDots, IconX } from '@tabler/icons-react';

import type { PlayerView } from '@hexfront/sim';

import styles from './VoteCard.module.css';
import { t } from '../i18n/dict.ts';
import { IconButton } from '../ui/icon-button.tsx';

type Vote = NonNullable<PlayerView['diplomacy']>['votes'][number];

/**
 * Карточка голосования альянса (вход нового члена, общий мир): вопрос, кто как проголосовал,
 * сколько «за» нужно, сколько секунд осталось и кнопки ответа. Решает больше половины избирателей.
 */
export function VoteCard(props: {
  readonly vote: Vote;
  readonly me: number;
  readonly nameOf: (playerId: number) => string;
  readonly colorOf: (playerId: number) => string;
  readonly onVote: (yes: boolean) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { vote, me, nameOf, colorOf } = props;
  const total = vote.voters.length;
  const need = Math.floor(total / 2) + 1;
  const title =
    vote.kind === 'peace'
      ? t('vote.peaceTitle')
      : vote.voters.includes(vote.a) && vote.voters.includes(vote.b)
        ? t('vote.mergeTitle')
        : t('vote.joinTitle');
  return (
    <section className={styles.card} role="dialog" aria-label={title} data-vote={vote.kind}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <IconButton className={styles.close} label={t('vote.close')} onClick={props.onClose}>
          <IconX size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <p className={styles.subject}>
        <span className={styles.dot} style={{ background: colorOf(vote.a) }} />
        {nameOf(vote.a)}
        <span className={styles.sep}>·</span>
        <span className={styles.dot} style={{ background: colorOf(vote.b) }} />
        {nameOf(vote.b)}
      </p>
      <ul className={styles.voters} aria-label={t('vote.voters')}>
        {vote.voters.map((id) => {
          const answer = vote.yes.includes(id) ? 'yes' : vote.no.includes(id) ? 'no' : 'wait';
          return (
            <li key={id} className={styles.voter} data-answer={answer}>
              <span className={styles.dot} style={{ background: colorOf(id) }} />
              <span className={styles.name}>{id === me ? t('vote.you') : nameOf(id)}</span>
              <span className={styles.mark} title={t(`vote.${answer}Hint` as 'vote.yesHint')}>
                {answer === 'yes' && <IconCheck size={16} aria-hidden="true" />}
                {answer === 'no' && <IconX size={16} aria-hidden="true" />}
                {answer === 'wait' && <IconDots size={16} aria-hidden="true" />}
              </span>
            </li>
          );
        })}
      </ul>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.barYes} style={{ width: `${(vote.yes.length / total) * 100}%` }} />
        <span className={styles.barNo} style={{ width: `${(vote.no.length / total) * 100}%` }} />
        <span className={styles.need} style={{ left: `${(need / total) * 100}%` }} />
      </div>
      <p className={styles.tally}>
        {t('vote.tally')
          .replace('{yes}', String(vote.yes.length))
          .replace('{no}', String(vote.no.length))
          .replace('{need}', String(need))
          .replace('{total}', String(total))}
        <span className={styles.left}>
          {vote.leftS} {t('match.seconds')}
        </span>
      </p>
      {vote.mine === null ? (
        <div className={styles.actions}>
          <button type="button" className={styles.yes} onClick={() => props.onVote(true)}>
            <IconCheck size={18} aria-hidden="true" />
            {t('vote.yes')}
          </button>
          <button type="button" className={styles.no} onClick={() => props.onVote(false)}>
            <IconX size={18} aria-hidden="true" />
            {t('vote.no')}
          </button>
        </div>
      ) : (
        <p className={styles.done}>{t(vote.mine === 'yes' ? 'vote.votedYes' : 'vote.votedNo')}</p>
      )}
    </section>
  );
}
