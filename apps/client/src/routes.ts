const QUICK_MATCH_PLAYERS = 30;

/** Ссылка на быстрый локальный матч из главного меню. */
export function quickMatchUrl(): string {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const params = new URLSearchParams({
    map: 'gen',
    seed: String(seed),
    players: String(QUICK_MATCH_PLAYERS),
  });
  return `/match?${params.toString()}`;
}

/** Проверяет, относится ли путь к обычному экрану матча. */
export function isMatchPath(path: string): boolean {
  return path === '/match';
}

/** Проверяет, относится ли путь к dev-страницам. */
export function isDevPath(path: string): boolean {
  return path === '/dev' || path.startsWith('/dev/');
}
