// Содержимое режимов главного меню: что внутри «Онлайн», «Против ботов», «Обучение». Модель общая
// для всех видов меню, а подаётся она по-разному (плашки на карте, карточка, список).
import {
  LEVELS,
  MAPS,
  PLAYERS_MAX,
  PLAYERS_MIN,
  PLAYERS_STEP,
  matchUrl,
  type MenuSettings,
} from './menu-config.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { tutorialUrl } from '../tutorial/links.ts';

export type ModeId = 'online' | 'bots' | 'tutorial';
export const MODE_IDS: readonly ModeId[] = ['online', 'bots', 'tutorial'];

export interface ModeItem {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly hint?: string;
  /** Главное действие режима: рисуется заметнее остальных. */
  readonly primary?: boolean;
  /** `go` — переход, `cycle` — переключатель по кругу, `code` — поле с кодом комнаты. */
  readonly kind: 'go' | 'cycle' | 'code';
  readonly run: (arg?: string) => void;
}

/** Следующий элемент списка по кругу. */
function cycle<T>(list: readonly T[], current: T): T {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length] ?? current;
}

export function modeTitle(mode: ModeId): string {
  return t(`menu.${mode === 'tutorial' ? 'startTutorial' : mode}` as MessageKey);
}

/** Короткое название режима для плашки и карточки. */
export function modeName(mode: ModeId): string {
  return mode === 'tutorial' ? t('tutorial.menuButton') : t(`menu.${mode}` as MessageKey);
}

export function modeSub(mode: ModeId): string {
  return t(
    `menu.sub${mode === 'online' ? 'Online' : mode === 'bots' ? 'Bots' : 'Tutorial'}` as MessageKey,
  );
}

/**
 * Пункты режима. `go` открывает адрес внутри приложения (сохранив настройки), `update` меняет
 * настройки матча против ботов.
 */
export function modeItems(
  mode: ModeId,
  s: MenuSettings,
  update: (patch: Partial<MenuSettings>) => void,
  go: (url: string) => void,
): readonly ModeItem[] {
  if (mode === 'online') {
    return [
      {
        id: 'quick',
        label: t('menu.quick'),
        hint: t('menu.subOnline'),
        primary: true,
        kind: 'go',
        run: () => go('/online'),
      },
      {
        id: 'lobby',
        label: t('menu.lobby'),
        hint: t('menu.lobbyHint'),
        kind: 'go',
        run: () => go('/online?mode=private'),
      },
      {
        id: 'code',
        label: t('menu.joinCode'),
        kind: 'code',
        run: (code) => {
          const room = (code ?? '').trim().toUpperCase();
          if (room !== '') go(`/online?room=${encodeURIComponent(room)}`);
        },
      },
    ];
  }
  if (mode === 'bots') {
    const chooser = MAPS.find((m) => m.id === s.map);
    const items: ModeItem[] = [
      { id: 'play', label: t('menu.play'), primary: true, kind: 'go', run: () => go(matchUrl(s)) },
      {
        id: 'map',
        label: t('menu.map'),
        value: t(`menu.map.${s.map}` as MessageKey),
        kind: 'cycle',
        run: () =>
          update({
            map: cycle(
              MAPS.map((m) => m.id),
              s.map,
            ),
          }),
      },
      {
        id: 'level',
        label: t('menu.difficulty'),
        value: t(`menu.difficulty.${s.level}` as MessageKey),
        kind: 'cycle',
        run: () => update({ level: cycle(LEVELS, s.level) }),
      },
    ];
    if (chooser?.choosePlayers) {
      items.push({
        id: 'players',
        label: t('menu.players'),
        value: String(s.players),
        kind: 'cycle',
        run: () =>
          update({
            players:
              s.players + PLAYERS_STEP > PLAYERS_MAX ? PLAYERS_MIN : s.players + PLAYERS_STEP,
          }),
      });
    }
    return items;
  }
  return [
    {
      id: 'start',
      label: t('menu.startTutorial'),
      hint: t('menu.subTutorial'),
      primary: true,
      kind: 'go',
      run: () => go(tutorialUrl(s.nickname, s.color)),
    },
  ];
}
