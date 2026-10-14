const QUICK_MATCH_PLAYERS = 30;

export const QUICK_MATCH_SEEDS = [
  42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61,
] as const;

/** Ссылка на быстрый локальный матч из главного меню. */
export function quickMatchUrl(): string {
  const seed = QUICK_MATCH_SEEDS[Math.floor(Math.random() * QUICK_MATCH_SEEDS.length)];
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
