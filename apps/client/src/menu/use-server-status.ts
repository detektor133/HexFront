// Связь с сервером матчей, пока открыто меню: опрос `/healthz`, число игроков в сети и мгновенное
// возвращение онлайна, когда связь появилась. HTTP-опрос не занимает место в комнате, в отличие от
// сокета игрока.
import { useEffect, useState } from 'react';

import { serverUrl } from '../net/online-session.ts';

export type ServerStatus =
  | { readonly state: 'checking' }
  | { readonly state: 'online'; readonly humans: number | null }
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

/** Запасная проверка: сокет открылся — сервер жив (работает и там, где /healthz закрыт для сайта). */
function socketOpens(socketUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    function finish(ok: boolean): void {
      clearTimeout(timer);
      ws.onopen = null;
      ws.onerror = null;
      ws.close();
      resolve(ok);
    }
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
  });
}

async function probe(socketUrl: string): Promise<ServerStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(healthUrl(socketUrl), {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.ok) {
      const body = (await response.json()) as { humans?: unknown };
      return { state: 'online', humans: typeof body.humans === 'number' ? body.humans : 0 };
    }
  } catch {
    // Нет ответа или сайту нельзя читать /healthz (старый сервер без CORS): пробуем сокет.
  } finally {
    clearTimeout(timer);
  }
  // Сервер жив, но число игроков неизвестно: плашка покажет просто «в сети».
  return (await socketOpens(socketUrl)) ? { state: 'online', humans: null } : { state: 'offline' };
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
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async (): Promise<void> => {
      if (timer !== null) clearTimeout(timer);
      const next = await probe(socketUrl);
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
