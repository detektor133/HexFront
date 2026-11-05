// Ход обучения: чистые функции — какой шаг сейчас, засчитан ли он и что сохранено на диске.
import { STEPS, type ChapterId, type Step, type TutorialCtx } from './script.ts';

/** Положение в главе: номер шага и снимок «до» для его предиката. */
export interface Progress {
  readonly index: number;
  readonly base: number;
}

/** Начало главы: первый шаг и его снимок. */
export function begin(chapter: ChapterId, ctx: TutorialCtx): Progress {
  const step = STEPS[chapter][0];
  return { index: 0, base: step?.base?.(ctx) ?? 0 };
}

/** Текущий шаг или undefined, если глава закончена. */
export function currentStep(chapter: ChapterId, index: number): Step | undefined {
  return STEPS[chapter][index];
}

/** Переход на следующий шаг со снимком «до» уже нового шага. */
export function next(chapter: ChapterId, at: Progress, ctx: TutorialCtx): Progress {
  const index = at.index + 1;
  return { index, base: STEPS[chapter][index]?.base?.(ctx) ?? 0 };
}

/**
 * Засчитан ли шаг: объяснительные шаги идут по кнопке, остальные — по действию игрока.
 * @returns true, если можно переходить дальше сами
 */
export function isDone(step: Step, ctx: TutorialCtx, base: number): boolean {
  if (step.manual || !step.done) return false;
  return step.done(ctx, base);
}

/**
 * Продвигает главу, пока очередные шаги уже выполнены (игрок опередил подсказку): шаги не
 * показываются зря. Объяснительные шаги останавливают продвижение.
 */
export function settle(chapter: ChapterId, at: Progress, ctx: TutorialCtx): Progress {
  let current = at;
  for (;;) {
    const step = currentStep(chapter, current.index);
    if (!step || !isDone(step, ctx, current.base)) return current;
    current = next(chapter, current, ctx);
  }
}

const KEY = 'hexfront.tutorial';
const ASKED_KEY = 'hexfront.tutorial.asked';

/** Какие главы пройдены. */
export function readDone(): readonly ChapterId[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? (list.filter((x) => typeof x === 'string') as ChapterId[]) : [];
  } catch {
    return [];
  }
}

/** Запоминает пройденную главу. */
export function markDone(chapter: ChapterId): void {
  try {
    const done = new Set(readDone());
    done.add(chapter);
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    // Без хранилища обучение просто предложат снова.
  }
}

/** Спрашивали ли игрока про обучение: вопрос задаётся один раз. */
export function wasAsked(): boolean {
  // Автотесты и скрипты не должны упираться в вопрос.
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Вопрос повторится при следующем запуске — не страшно.
  }
}
