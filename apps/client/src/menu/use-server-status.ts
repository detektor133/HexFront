// Связь с сервером матчей, пока открыто меню: опрос `/healthz`, число игроков в сети и мгновенное
// возвращение онлайна, когда связь появилась. HTTP-опрос не занимает место в комнате, в отличие от
// сокета игрока.
import { useEffect, useState } from 'react';

import { serverUrl } from '../net/online-session.ts';

export type ServerStatus =
  | { readonly state: 'checking' }
  | { readonly state: 'online'; readonly humans: number }
  | { readonly state: 'offline' };

/** Как часто спрашиваем сервер, пока он жив, и пока его нет, мс. */
export const POLL_ONLINE_MS = 15_000;
export const POLL_OFFLINE_MS = 3000;
const TIMEOUT_MS = 4000;

/** Адрес проверки по адресу сокета: `wss://хост` → `https://хост/healthz`. */
export function healthUrl(socketUrl: string): string {
  return `${socketUrl.replace(/^ws/, 'http').replace(/\/+$/, '')}/healthz`;
}

/** Число игроков для плашки: 842, 1,2к, 15к. */
export function shortCount(n: number, thousand: string): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace('.', ',') : Math.round(k)}${thousand}`;
}

async function probe(url: string): Promise<ServerStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return { state: 'offline' };
    const body = (await response.json()) as { humans?: unknown };
    return { state: 'online', humans: typeof body.humans === 'number' ? body.humans : 0 };
  } catch {
    return { state: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Состояние сервера: проверка при открытии, редкий опрос при связи, частый без неё. */
export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({ state: 'checking' });
  useEffect(() => {
    const socketUrl = serverUrl(window.location.search);
    if (socketUrl === null) {
      setStatus({ state: 'offline' });
      return;
    }
    const url = healthUrl(socketUrl);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async (): Promise<void> => {
      if (timer !== null) clearTimeout(timer);
      const next = await probe(url);
      if (disposed) return;
      setStatus(next);
      timer = setTimeout(
        () => void check(),
        next.state === 'online' ? POLL_ONLINE_MS : POLL_OFFLINE_MS,
      );
    };
    const recheck = (): void => void check();
    void check();
    // Браузер сообщил о появлении сети или вкладку открыли снова — не ждём очередного опроса.
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);
  return status;
}
