// Случайное имя вкладки: по нему сервер считает людей «в сети» (две вкладки — два человека),
// не зная, кто это. Живёт, пока открыта вкладка.
const KEY = 'hexfront.tab';

export function tabId(): string {
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved !== null && /^[a-z0-9]{6,32}$/.test(saved)) return saved;
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
      b.toString(36).padStart(2, '0'),
    ).join('');
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Хранилище закрыто: имя на один запуск, сервер посчитает вкладку по адресу.
    return Math.random().toString(36).slice(2, 14).padEnd(6, '0');
  }
}
