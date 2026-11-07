// Режиссёр матча-урока: соперник не думает и не растёт сам, он делает ровно то, что нужно текущему
// шагу урока. Номер шага приходит со страницы; каждое действие срабатывает один раз.
import { FP, type Fp, type MatchState, type PlayerCommand } from '@hexfront/sim';

/** Игрок-соперник в матче-уроке. */
export const TUTORIAL_ENEMY = 1;

/** Игрок-человек в матче-уроке. */
const TUTORIAL_HUMAN = 0;

/** Сколько солдат соперник набирает на границе, когда игрок подводит армию. */
export const ENEMY_DEFENDERS = 350;

/** Золото соперника на оборону, монет: хватает на любой набор урока. */
const ENEMY_GOLD = 3000;

export interface TutorialDirector {
  /** Текущий шаг урока (id из script.ts). */
  stage: string;
  readonly fired: Set<string>;
}

export function createDirector(): TutorialDirector {
  return { stage: '', fired: new Set() };
}

/**
 * Команды соперника на этот тик. Сейчас у него одно действие: когда игрок решил держать границу,
 * соперник набирает оборону на ней — так у войны есть защитники и победа не бесплатна.
 * @returns команды от имени соперника
 */
export function directorCommands(state: MatchState, director: TutorialDirector): PlayerCommand[] {
  const out: PlayerCommand[] = [];
  const enemy = state.players[TUTORIAL_ENEMY];
  if (!enemy || enemy.status !== 'alive') return out;
  if (director.stage === 'hold' && !director.fired.has('defend')) {
    director.fired.add('defend');
    enemy.gold = (enemy.gold + ENEMY_GOLD * FP) as Fp;
    out.push({
      playerId: TUTORIAL_ENEMY,
      cmd: { t: 'holdBorder', target: TUTORIAL_HUMAN, soldiers: ENEMY_DEFENDERS },
    });
  }
  return out;
}
