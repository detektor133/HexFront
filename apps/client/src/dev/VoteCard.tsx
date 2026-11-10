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
  // Общий мир решает каждая сторона отдельно; вход в альянс — одна группа избирателей.
  const sides = vote.sides.length > 0 ? vote.sides : [vote.voters];
  const title =
    vote.kind === 'peace'
      ? t('vote.peaceTitle')
      : vote.kind === 'kick'
        ? t('vote.kickTitle')
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
      {vote.result !== null && (
        <p className={styles.outcome} data-result={vote.result}>
          {t(vote.result === 'passed' ? 'vote.passed' : 'vote.failed')}
        </p>
      )}
      <p className={styles.subject}>
        <span className={styles.dot} style={{ background: colorOf(vote.a) }} />
        {nameOf(vote.a)}
        <span className={styles.sep}>·</span>
        <span className={styles.dot} style={{ background: colorOf(vote.b) }} />
        {nameOf(vote.b)}
      </p>
      {sides.map((side, index) => {
        const members = side.filter((id) => vote.voters.includes(id));
        // Сторона из одного (сам предлагающий или согласившийся) уже ответила «за».
        if (members.length === 0 || (sides.length > 1 && members.length === 1)) return null;
        const total = members.length;
        const yes = members.filter((id) => vote.yes.includes(id)).length;
        const no = members.filter((id) => vote.no.includes(id)).length;
        const need = Math.floor(total / 2) + 1;
        return (
          <div key={index} className={styles.group}>
            {sides.length > 1 && (
              <p className={styles.side}>
                {t('vote.side')}:{' '}
                {members.map((id) => (id === me ? t('vote.you') : nameOf(id))).join(', ')}
              </p>
            )}
            <ul className={styles.voters} aria-label={t('vote.voters')}>
              {members.map((id) => {
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
              <span className={styles.barYes} style={{ width: `${(yes / total) * 100}%` }} />
              <span className={styles.barNo} style={{ width: `${(no / total) * 100}%` }} />
              <span className={styles.need} style={{ left: `${(need / total) * 100}%` }} />
            </div>
            <p className={styles.tally}>
              {t('vote.tally')
                .replace('{yes}', String(yes))
                .replace('{no}', String(no))
                .replace('{need}', String(need))
                .replace('{total}', String(total))}
              {index === 0 && vote.result === null && (
                <span className={styles.left}>
                  {vote.leftS} {t('match.seconds')}
                </span>
              )}
            </p>
          </div>
        );
      })}
      {vote.result !== null ? null : !vote.canVote ? (
        <p className={styles.done}>{t('vote.watching')}</p>
      ) : vote.mine === null ? (
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
