// Части меню: плашка ника с цветом и панели режимов. Все варианты показаны сразу: сложность и карту
// не нужно перебирать нажатиями по кругу.
import { IconArrowLeft } from '@tabler/icons-react';
import { useState } from 'react';

import { CodeRow } from './CodeRow.tsx';
import { MapPicker } from './MapPicker.tsx';
import { Stepper } from './Stepper.tsx';
import {
  LEVELS,
  NICK_MAX,
  guestNick,
  matchUrl,
  maxPlayersOf,
  randomGenSeed,
  nickProblem,
  type MenuSettings,
} from './menu-config.ts';
import styles from './menu-ui.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { loadOnlineSession } from '../net/online-session.ts';
import { tokens } from '../theme/tokens.ts';
import { tutorialUrl } from '../tutorial/links.ts';

export type ModeId = 'online' | 'bots';

const NO_TAKEN: ReadonlyMap<number, string> = new Map();

export function modeName(mode: ModeId): string {
  return t(mode === 'online' ? 'menu.online' : 'menu.bots');
}

export function colorLine(id: string): string {
  return tokens.players.palette.find((p) => p.id === id)?.line ?? 'var(--selection-color)';
}

/** Ник и цвет: ввод всегда на виду, один символ не принимается. */
export function NickPlate(props: {
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  /** Растёт на единицу, когда меню отказало в переходе из-за ника: плашка встряхивается. */
  readonly shake: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const bad = nickProblem(props.settings.nickname);
  return (
    <div
      key={props.shake}
      className={`${styles.nickWrap} ${bad ? styles.bad : ''} ${props.shake > 0 ? styles.shake : ''}`}
    >
      <div className={styles.nick}>
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
          // Поле не остаётся пустым: ушли из него — вернулось имя по умолчанию.
          onBlur={() => {
            if (props.settings.nickname.trim() === '') props.update({ nickname: guestNick() });
          }}
        />
        {bad && <span className={styles.problem}>{t('menu.nickShort')}</span>}
      </div>
      {open && (
        <div className={styles.swatches} role="radiogroup" aria-label={t('menu.color')}>
          {tokens.players.palette.map((c) => (
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

export function Chips<T extends string>(props: {
  readonly label: string;
  readonly options: readonly { readonly id: T; readonly text: string }[];
  readonly value: T;
  readonly onPick: (id: T) => void;
  /** Тесная строка: подпись слева, кнопки справа (лобби). */
  readonly dense?: boolean;
}): React.JSX.Element {
  return (
    <div className={`${styles.group} ${props.dense === true ? styles.dense : ''}`}>
      <div className={styles.groupLabel}>{props.label}</div>
      <div className={styles.chips} role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === props.value}
            className={`${styles.chip} ${o.id === props.value ? styles.chosen : ''}`}
            onClick={() => props.onPick(o.id)}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Action(props: {
  readonly label: string;
  readonly hint?: string;
  readonly primary?: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${styles.action} ${props.primary === true ? styles.primary : ''}`}
      onClick={props.onPress}
    >
      <span>
        {props.label}
        {props.hint !== undefined && <small>{props.hint}</small>}
      </span>
    </button>
  );
}

function OnlineBody(props: { readonly go: (url: string) => void }): React.JSX.Element {
  return (
    <>
      {loadOnlineSession() !== null && (
        <Action
          primary
          label={t('lobby.backToMatch')}
          onPress={() => props.go('/online?resume=1')}
        />
      )}
      <Action
        primary={loadOnlineSession() === null}
        label={t('menu.quick')}
        hint={t('menu.subOnline')}
        onPress={() => props.go('/online')}
      />
      <Action
        label={t('menu.lobby')}
        hint={t('menu.lobbyHint')}
        onPress={() => props.go('/online?mode=private')}
      />
      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('menu.joinCode')}</div>
        <CodeRow
          onJoin={(room, spectate) =>
            props.go(`/online?room=${encodeURIComponent(room)}${spectate ? '&spectate=1' : ''}`)
          }
        />
      </div>
    </>
  );
}

function BotsBody(props: {
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly go: (url: string) => void;
}): React.JSX.Element {
  const s = props.settings;
  const max = maxPlayersOf(s.map, s.genSize);
  const players = Math.min(s.players, max);
  return (
    <>
      <Action primary label={t('menu.play')} onPress={() => props.go(matchUrl(s))} />
      <MapPicker
        map={s.map}
        editable
        onMap={(map) =>
          props.update({
            map,
            players: Math.min(s.players, maxPlayersOf(map, s.genSize)),
            spawn: null,
          })
        }
        seed={s.seed}
        onOtherMap={() => props.update({ seed: randomGenSeed(s.seed), spawn: null })}
        genSize={s.genSize}
        onGenSize={(genSize) =>
          props.update({ genSize, players: Math.min(s.players, genSize), spawn: null })
        }
        players={players}
        spawn={s.spawn}
        taken={NO_TAKEN}
        onSpawn={(spawn) => props.update({ spawn })}
      />
      <div className={`${styles.group} ${styles.dense}`}>
        <div className={styles.groupLabel}>{t('menu.botsCount')}</div>
        <Stepper
          label={t('menu.botsCount')}
          min={1}
          max={max - 1}
          value={players - 1}
          onChange={(bots) => props.update({ players: bots + 1 })}
        />
      </div>
      <Chips
        dense
        label={t('menu.difficulty')}
        options={LEVELS.map((l) => ({ id: l, text: t(`menu.difficulty.${l}` as MessageKey) }))}
        value={s.level}
        onPick={(level) => props.update({ level })}
      />
    </>
  );
}

/** Панель режима: заголовок со стрелкой назад и всё содержимое режима. */
export function ModePanel(props: {
  readonly mode: ModeId;
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly go: (url: string) => void;
  readonly onBack: () => void;
  readonly className: string;
}): React.JSX.Element {
  return (
    <div
      className={`${styles.panel} ${props.className}`}
      role="group"
      aria-label={modeName(props.mode)}
    >
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
      {props.mode === 'online' ? (
        <OnlineBody go={props.go} />
      ) : (
        <BotsBody settings={props.settings} update={props.update} go={props.go} />
      )}
    </div>
  );
}

/** Ссылка на обучение: понадобится вопросу про обучение при первом входе. */
export function tutorialLink(settings: MenuSettings): string {
  return tutorialUrl(settings.nickname, settings.color);
}
