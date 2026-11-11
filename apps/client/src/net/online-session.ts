// Параметры онлайн-матча, которые лобби передаёт экрану игры: адрес сервера и токен места.
const KEY = 'hexfront.online';

export interface OnlineSessionInfo {
  readonly token: string;
  readonly server: string;
  readonly nick: string;
}

/** Параметр `server` в ссылке принимается только для локального сервера (проверки и разработка). */
const LOCAL_SERVER = /^ws:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/;

/**
 * Адрес сервера матчей. В сборке задаётся `VITE_SERVER_URL` (wss://…); при разработке сервер
 * запускается рядом на порту 8080; в ссылке можно передать только локальный `server=ws://127.0.0.1:порт`.
 */
export function serverUrl(search = ''): string | null {
  const override = new URLSearchParams(search).get('server');
  if (override !== null && LOCAL_SERVER.test(override)) return override;
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured !== undefined && configured !== '') return configured;
  if (import.meta.env.DEV) return `ws://${window.location.hostname}:8080`;
  return null;
}

/** Запоминает сессию на время вкладки (не между сеансами: токен ценен 30 с после обрыва). */
export function saveOnlineSession(info: OnlineSessionInfo): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    // Хранилище закрыто (приватное окно): экран игры не найдёт токен и покажет ошибку входа.
  }
}

export function loadOnlineSession(): OnlineSessionInfo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<OnlineSessionInfo>;
    if (
      typeof value.token === 'string' &&
      typeof value.server === 'string' &&
      typeof value.nick === 'string'
    ) {
      return { token: value.token, server: value.server, nick: value.nick };
    }
  } catch {
    // Повреждённая запись равна отсутствию сессии.
  }
  return null;
}
