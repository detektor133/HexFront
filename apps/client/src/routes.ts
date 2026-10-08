const QUICK_MATCH_PLAYERS = 30;
const QUICK_MATCH_SEED = 42;

/** Ссылка на быстрый локальный матч из главного меню. */
export function quickMatchUrl(): string {
  const params = new URLSearchParams({
    map: 'gen',
    seed: String(QUICK_MATCH_SEED),
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
