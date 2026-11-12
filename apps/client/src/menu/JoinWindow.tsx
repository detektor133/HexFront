// Окно «Войти по коду»: крупное поле кода и два понятных действия — занять место или смотреть
// идущий матч. Вставленная ссылка-приглашение разбирается сама.
import { IconArrowLeft, IconEye, IconPlayerPlay } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import styles from './join-window.module.css';
import ui from './menu-ui.module.css';
import { t } from '../i18n/dict.ts';

const CODE_MAX = 16;

/** Код из набранного текста или из вставленной ссылки `…?room=КОД`; пусто — кода нет. */
export function roomCodeOf(text: string): string {
  const trimmed = text.trim();
  const link = /[?&]room=([^&#\s]+)/i.exec(trimmed);
  const raw = link?.[1] ?? trimmed;
  return raw.replace(/[^a-z0-9]/gi, '').slice(0, CODE_MAX);
}

export function JoinWindow(props: {
  readonly className: string;
  readonly onClose: () => void;
  readonly onJoin: (room: string, spectate: boolean) => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const code = roomCodeOf(text);
  const ready = code.length >= 3;
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const submit = (spectate: boolean): void => {
    if (ready) props.onJoin(code.toLowerCase(), spectate);
  };
  return (
    <div className={ui.backdrop}>
      <div
        className={`${ui.modal} ${styles.window} ${props.className}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('menu.joinCode')}
      >
        <div className={ui.panelHead}>
          <button
            type="button"
            className={ui.back}
            aria-label={t('menu.back')}
            onClick={props.onClose}
          >
            <IconArrowLeft size={22} aria-hidden="true" />
          </button>
          <h2 className={ui.panelTitle}>{t('menu.joinCode')}</h2>
        </div>
        <label className={styles.field}>
          <input
            ref={inputRef}
            value={text}
            className={styles.code}
            placeholder={t('menu.codePlaceholder')}
            aria-label={t('menu.codePlaceholder')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit(false);
            }}
          />
          <small>{t('join.hint')}</small>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${ui.action} ${ui.primary} ${styles.choice}`}
            disabled={!ready}
            onClick={() => submit(false)}
          >
            <IconPlayerPlay size={22} aria-hidden="true" />
            <span>
              {t('join.play')}
              <small>{t('join.playHint')}</small>
            </span>
          </button>
          <button
            type="button"
            className={`${ui.action} ${styles.choice}`}
            disabled={!ready}
            onClick={() => submit(true)}
          >
            <IconEye size={22} aria-hidden="true" />
            <span>
              {t('join.watch')}
              <small>{t('join.watchHint')}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
