// Вход по коду прямо в панели «Онлайн»: поле и кнопка в одной строке, без отдельного окна. Ссылка
// из приглашения вставляется целиком — код (и пометка «смотреть») достаются из неё.
import { IconArrowRight } from '@tabler/icons-react';
import { useState } from 'react';

import styles from './code-row.module.css';
import { t } from '../i18n/dict.ts';

const CODE_MAX = 16;
const CODE_MIN = 3;

/** Код из набранного текста или из вставленной ссылки `…?room=КОД`; пусто — кода нет. */
export function roomCodeOf(text: string): string {
  const trimmed = text.trim();
  const link = /[?&]room=([^&#\s]+)/i.exec(trimmed);
  const raw = link?.[1] ?? trimmed;
  return raw.replace(/[^a-z0-9]/gi, '').slice(0, CODE_MAX);
}

/** Ссылка помечена «смотреть» (`spectate=1`): вход зрителем, а не игроком. */
export function spectateOf(text: string): boolean {
  return /[?&]spectate=1(?:[&#\s]|$)/i.test(text);
}

export function CodeRow(props: {
  readonly onJoin: (room: string, spectate: boolean) => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const code = roomCodeOf(text);
  const ready = code.length >= CODE_MIN;
  const submit = (): void => {
    if (ready) props.onJoin(code.toLowerCase(), spectateOf(text));
  };
  return (
    <div className={styles.row}>
      <input
        value={text}
        className={styles.code}
        placeholder={t('menu.codePlaceholder')}
        aria-label={t('menu.joinCode')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
      <button
        type="button"
        className={styles.go}
        disabled={!ready}
        aria-label={t('join.enter')}
        title={t('join.enter')}
        onClick={submit}
      >
        <IconArrowRight size={22} aria-hidden="true" />
      </button>
    </div>
  );
}
