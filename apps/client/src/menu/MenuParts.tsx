// Общие части новых видов меню: плашка ника и панель режима.
import { IconArrowLeft } from '@tabler/icons-react';
import { useState } from 'react';

import { NICK_MAX, nickProblem, type MenuSettings } from './menu-config.ts';
import styles from './menu-ui.module.css';
import { modeItems, modeName, type ModeId } from './mode-items.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';

export function colorLine(id: string): string {
  return tokens.players.palette.find((p) => p.id === id)?.line ?? 'var(--selection-color)';
}

/** Ник и цвет: ввод всегда на виду, один символ не принимается. `shake` встряхивает плашку. */
export function NickPlate(props: {
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly shake: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const bad = nickProblem(props.settings.nickname);
  return (
    <div className={styles.nickWrap}>
      <div
        key={props.shake}
        className={`${styles.nick} ${bad ? styles.bad : ''} ${props.shake > 0 ? styles.shake : ''}`}
      >
        <button
          type="button"
          className={styles.dot}
          style={{ backgroundColor: colorLine(props.settings.color) }}
          aria-label={t('menu.color')}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
        <input
          value={props.settings.nickname}
          maxLength={NICK_MAX}
          placeholder={t('menu.namePlaceholder')}
          aria-label={t('menu.nickname')}
          autoComplete="nickname"
          onChange={(event) => props.update({ nickname: event.target.value.slice(0, NICK_MAX) })}
        />
        {bad && <span className={styles.problem}>{t('menu.nickShort')}</span>}
      </div>
      {open && (
        <div className={styles.swatches} role="radiogroup" aria-label={t('menu.color')}>
          {tokens.players.palette.slice(0, 12).map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === props.settings.color}
              aria-label={`${t('menu.color')} ${c.id}`}
              className={`${styles.swatch} ${c.id === props.settings.color ? styles.selected : ''}`}
              style={{ backgroundColor: c.line }}
              onClick={() => {
                props.update({ color: c.id });
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Панель режима: пункты крупными кнопками, сверху стрелка назад. */
export function ModePanel(props: {
  readonly mode: ModeId;
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly go: (url: string) => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState('');
  const items = modeItems(props.mode, props.settings, props.update, props.go);
  return (
    <div className={styles.panel} role="group" aria-label={modeName(props.mode)}>
      <div className={styles.panelHead}>
        <button
          type="button"
          className={styles.back}
          aria-label={t('menu.back')}
          onClick={props.onBack}
        >
          <IconArrowLeft size={22} aria-hidden="true" />
        </button>
        <h2 className={styles.panelTitle}>{modeName(props.mode)}</h2>
      </div>
      {items.map((item) =>
        item.kind === 'code' ? (
          <div key={item.id} className={styles.codeRow}>
            <input
              value={code}
              maxLength={12}
              placeholder={t('menu.codePlaceholder')}
              aria-label={item.label}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') item.run(code);
              }}
            />
            <button type="button" onClick={() => item.run(code)}>
              {t('menu.join')}
            </button>
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            className={`${styles.item} ${item.primary === true ? styles.primary : ''}`}
            onClick={() => item.run()}
          >
            <span>
              <b>{item.label}</b>
              {item.hint !== undefined && <small>{item.hint}</small>}
            </span>
            {item.value !== undefined && <span className={styles.value}>{item.value}</span>}
          </button>
        ),
      )}
    </div>
  );
}
