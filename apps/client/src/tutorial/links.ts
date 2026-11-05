import { START_GOLD, type ChapterId } from './script.ts';

/** Карта и зерно матча-урока: маленькая карта, соперник в другом углу. */
const TUTORIAL_MAP = 'tiny';
const TUTORIAL_SEED = 42;

/** Ссылка на матч-урок главы: два игрока, соперник стоит, золота столько, сколько нужно главе. */
export function tutorialUrl(chapter: ChapterId, name: string, color: string): string {
  const params = new URLSearchParams({
    map: TUTORIAL_MAP,
    seed: String(TUTORIAL_SEED),
    players: '2',
    tutorial: chapter,
    initialGold: String(START_GOLD[chapter]),
    color,
  });
  if (name !== '') params.set('name', name);
  return `/match?${params.toString()}`;
}
