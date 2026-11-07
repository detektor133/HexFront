import { START_GOLD } from './script.ts';

/** Карта и зерно матча-урока: маленькая карта, соперник в другом углу. */
const TUTORIAL_MAP = 'tiny';
const TUTORIAL_SEED = 42;

/** Ссылка на матч-урок: два игрока, соперником управляет режиссёр урока, золота хватает на всё. */
export function tutorialUrl(name: string, color: string): string {
  const params = new URLSearchParams({
    map: TUTORIAL_MAP,
    seed: String(TUTORIAL_SEED),
    players: '2',
    tutorial: 'core',
    initialGold: String(START_GOLD),
    color,
  });
  if (name !== '') params.set('name', name);
  return `/match?${params.toString()}`;
}
