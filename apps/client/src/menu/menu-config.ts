// Общие настройки меню: ник, цвет и параметры матча против ботов. Хранятся в localStorage, чтобы
// все виды меню и онлайн-лобби видели одно и то же.
import { useCallback, useState } from 'react';

import { t } from '../i18n/dict.ts';
import { QUICK_MATCH_SEEDS } from '../routes.ts';
import { COLOR_KEY, NICKNAME_KEY } from './storage-keys.ts';
import { tokens } from '../theme/tokens.ts';

const MAP_KEY = 'hexfront.map';
const PLAYERS_KEY = 'hexfront.players';
const LEVEL_KEY = 'hexfront.botLevel';

/** Карты меню: id, размер в гексах и предел числа игроков (точек старта на карте). */
export const MAPS = [
  { id: 'europe', size: '115×92', choosePlayers: true, maxPlayers: 30 },
  { id: 'gen', size: '80×60', choosePlayers: false, maxPlayers: 30 },
  { id: 'small', size: '40×30', choosePlayers: false, maxPlayers: 6 },
  { id: 'tiny', size: '20×15', choosePlayers: false, maxPlayers: 2 },
  { id: 'mediterranean', size: '144×56', choosePlayers: true, maxPlayers: 16 },
  { id: 'north', size: '107×75', choosePlayers: true, maxPlayers: 14 },
  { id: 'namerica', size: '120×75', choosePlayers: true, maxPlayers: 16 },
  { id: 'japan', size: '71×64', choosePlayers: true, maxPlayers: 8 },
  { id: 'mideast', size: '119×68', choosePlayers: true, maxPlayers: 14 },
  { id: 'continent', size: '110×80', choosePlayers: true, maxPlayers: 24 },
  { id: 'archipelago', size: '100×70', choosePlayers: true, maxPlayers: 18 },
] as const;
export type MenuMapId = (typeof MAPS)[number]['id'];

export const LEVELS = ['easy', 'normal', 'hard'] as const;
export type MenuLevel = (typeof LEVELS)[number];

export const PLAYERS_MIN = 2;
export const PLAYERS_MAX = 30;
const PLAYERS_DEFAULT = 12;
const LEVEL_DEFAULT: MenuLevel = 'normal';

/** Ник короче этого в игру не берётся (сервер отклонит), поэтому меню не даёт его оставить. */
export const NICK_MIN = 2;
export const NICK_MAX = 16;

export interface MenuSettings {
  readonly nickname: string;
  readonly color: string;
  readonly map: MenuMapId;
  readonly players: number;
  readonly level: MenuLevel;
  /** Зерно случайной карты (из готовых) и выбранная точка старта; не хранятся между сеансами. */
  readonly seed: number;
  readonly spawn: number | null;
}

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Хранилище закрыто: настройки живут до закрытия вкладки.
  }
}

const GUEST_KEY = 'hexfront.guestNumber';

/**
 * Имя по умолчанию «Игрок 4821»: номер создаётся один раз и хранится в браузере, поэтому у одного
 * игрока оно не меняется от входа к входу, а у разных людей почти не совпадает.
 */
export function guestNick(): string {
  let number = Number(read(GUEST_KEY, ''));
  if (!Number.isInteger(number) || number < 1000) {
    number = 1000 + Math.floor(Math.random() * 9000);
    write(GUEST_KEY, String(number));
  }
  return `${t('menu.defaultNick')} ${number}`;
}

/** Цвет при первом входе выбирается случайно и запоминается: все новички не бирюзовые. */
function firstColor(): string {
  const saved = read(COLOR_KEY, '');
  if (tokens.players.palette.some((p) => p.id === saved)) return saved;
  const pick = tokens.players.palette[Math.floor(Math.random() * tokens.players.palette.length)];
  const id = pick?.id ?? 'teal';
  write(COLOR_KEY, id);
  return id;
}

export function loadSettings(): MenuSettings {
  const players = Number(read(PLAYERS_KEY, String(PLAYERS_DEFAULT)));
  return {
    nickname: read(NICKNAME_KEY, '') || guestNick(),
    color: firstColor(),
    map: MAPS.find((m) => m.id === read(MAP_KEY, 'europe'))?.id ?? 'europe',
    players: Number.isInteger(players)
      ? Math.min(PLAYERS_MAX, Math.max(PLAYERS_MIN, players))
      : PLAYERS_DEFAULT,
    level: LEVELS.find((l) => l === read(LEVEL_KEY, LEVEL_DEFAULT)) ?? LEVEL_DEFAULT,
    seed: randomGenSeed(),
    spawn: null,
  };
}

function saveSettings(s: MenuSettings): void {
  write(NICKNAME_KEY, s.nickname);
  write(COLOR_KEY, s.color);
  write(MAP_KEY, s.map);
  write(PLAYERS_KEY, String(s.players));
  write(LEVEL_KEY, s.level);
}

/** Настройки с немедленным сохранением: «Играть» и лобби читают их из хранилища. */
export function useMenuSettings(): readonly [MenuSettings, (patch: Partial<MenuSettings>) => void] {
  const [settings, setSettings] = useState<MenuSettings>(loadSettings);
  const update = useCallback((patch: Partial<MenuSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  return [settings, update];
}

/** Ник годится для входа: пустой допустим (подставится имя по умолчанию), один символ — нет. */
export function nickProblem(nickname: string): boolean {
  return nickname.length > 0 && nickname.length < NICK_MIN;
}

/** Случайное зерно матча на Европе: стартовые позиции и порядок игроков каждый раз другие. */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Предел игроков карты меню. */
export function maxPlayersOf(map: MenuMapId): number {
  return MAPS.find((m) => m.id === map)?.maxPlayers ?? PLAYERS_MAX;
}

/** Другое зерно случайной карты из готовых (кнопка «Сгенерировать»). */
export function randomGenSeed(except?: number): number {
  const pool = QUICK_MATCH_SEEDS.filter((seed) => seed !== except);
  return pool[Math.floor(Math.random() * pool.length)] ?? QUICK_MATCH_SEEDS[0];
}

/** Ссылка на матч против ботов по настройкам меню. */
export function matchUrl(s: MenuSettings): string {
  const players = Math.min(s.players, maxPlayersOf(s.map));
  const seed = s.map === 'gen' ? s.seed : s.map === 'europe' ? randomSeed() : 42;
  const url = new URL(
    `/match?map=${s.map}&seed=${seed}&players=${players}`,
    window.location.origin,
  );
  if (s.spawn !== null) url.searchParams.set('spawn', String(s.spawn));
  if (s.nickname !== '') url.searchParams.set('name', s.nickname);
  url.searchParams.set('color', s.color);
  url.searchParams.set('difficulty', s.level);
  return `${url.pathname}?${url.searchParams.toString()}`;
}
